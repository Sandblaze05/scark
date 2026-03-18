/**
 * Electron Main Process
 *
 * - Spawns the BrowserWindow loading Next.js (dev server or static export)
 * - Initialises worker pools for ingestion and query pipelines
 * - Exposes IPC handlers so the renderer can drive pipelines and queries
 */

import { app, BrowserWindow, ipcMain, session, clipboard } from 'electron';
// Load environment overrides early so services/readers pick them up (packaged EXE support)
import '../lib/envLoader.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { WorkerPool } from '../workers/pool.js';
import ServiceManager from '../lib/ServiceManager.js';
// ensure chroma launcher registers itself
import '../services/chromaLauncher.js';
import { buildSystemPrompt, rewriteQuery, requiresFreshData, requiresSearch } from '../services/chatService.js';
import {
    addChatMessage,
    createChatSession,
    deleteChatSession,
    getChatSession,
    listChatSessions,
    renameChatSession,
    setChatPinned,
    setChatSummary,
    touchChatSession,
    truncateChatMessages,
    setChatTurnVersions,
    getProfile,
    setProfile,
} from '../services/sqliteService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:3000';

// ── GPU selection ─────────────────────────────────────────
// Force high-performance GPU by default
if (process.env.SCARK_DISABLE_HIGH_PERF_GPU !== '1') {
    app.commandLine.appendSwitch('force_high_performance_gpu');
}

let mainWindow;
let ingestionPool;
let queryPool;
const INGESTION_POOL_SIZE = parseInt(process.env.SCARK_INGESTION_POOL_SIZE || '', 10) || (isDev ? 2 : 3);
const QUERY_POOL_SIZE = parseInt(process.env.SCARK_QUERY_POOL_SIZE || '', 10) || (isDev ? 2 : 2);
const INTERACTIVE_MAX_QUEUE_DEPTH = parseInt(process.env.SCARK_INTERACTIVE_MAX_QUEUE_DEPTH || '', 10) || 3;
const WEBSEARCH_RESULT_TTL_MS = 120000;
const webSearchRequests = new Map();
const PROMOTION_MIN_HITS = parseInt(process.env.SCARK_PROMOTE_MIN_HITS || '2', 10);
const PROMOTION_MAX_PAGES = parseInt(process.env.SCARK_PROMOTE_MAX_PAGES || '2', 10);
const PROMOTION_MIN_TEXT_LEN = parseInt(process.env.SCARK_PROMOTE_MIN_TEXT_LEN || '220', 10);
const promotionHits = new Map();
let promotionQueue = Promise.resolve();

function parseAutostartServiceList() {
    const raw = (process.env.SCARK_SERVICES_AUTOSTART || 'chroma').trim();
    if (!raw) return [];
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function scheduleWebSearchCleanup(requestId) {
    setTimeout(() => {
        const entry = webSearchRequests.get(requestId);
        if (!entry) return;
        if (entry.status === 'completed' || entry.status === 'failed' || entry.status === 'canceled' || entry.status === 'busy') {
            webSearchRequests.delete(requestId);
        }
    }, WEBSEARCH_RESULT_TTL_MS);
}

function rankPromotionCandidates(query, results = []) {
    const q = String(query || '').toLowerCase();
    const qTokens = q.split(/\s+/).filter(Boolean);
    const items = [];

    for (const r of results) {
        if (!r?.url || typeof r?.text !== 'string') continue;
        if (r.text.trim().length < PROMOTION_MIN_TEXT_LEN) continue;

        const previousHits = promotionHits.get(r.url) || 0;
        const nextHits = previousHits + 1;
        promotionHits.set(r.url, nextHits);

        const hay = `${r.title || ''} ${r.text.slice(0, 600)}`.toLowerCase();
        const overlap = qTokens.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
        const score = (nextHits * 10) + overlap;

        items.push({ ...r, score, hits: nextHits });
    }

    return items
        .filter((x) => x.hits >= PROMOTION_MIN_HITS)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(0, PROMOTION_MAX_PAGES));
}

function enqueuePromotion(query, results = []) {
    const candidates = rankPromotionCandidates(query, results);
    if (candidates.length === 0) return;

    promotionQueue = promotionQueue
        .then(async () => {
            const pool = getIngestionPool();
            await pool.exec({
                type: 'promoteSearchResults',
                data: { results: candidates },
            }, { priority: 1 });
            console.log(`[WebSearch] Promoted ${candidates.length} result(s) to long-term RAG store.`);
        })
        .catch((e) => {
            console.warn('[WebSearch] Promotion failed:', e?.message || e);
        });
}

function ensureDefaultChat() {
    const chats = listChatSessions();
    if (chats.length > 0) return chats;
    createChatSession({ title: 'New chat' });
    return listChatSessions();
}

function broadcastChatListUpdated() {
    const chats = ensureDefaultChat();
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('chat:list-updated', chats));
}

function broadcastChatSelected(chatId) {
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('chat:selected', chatId));
}

// ── Window ────────────────────────────────────────────────

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    mainWindow.setMenuBarVisibility(false)

    // Grant microphone + speech-recognition permissions automatically
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        const allowed = ['media', 'microphone', 'speechRecognition'];
        callback(allowed.includes(permission));
    });

    // Set COOP/COEP headers required for SharedArrayBuffer (used by WebLLM/WASM)
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Cross-Origin-Opener-Policy': ['same-origin'],
                'Cross-Origin-Embedder-Policy': ['require-corp'],
            },
        });
    });

    if (isDev) {
        mainWindow.loadURL(DEV_URL);
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/out/index.html'));
    }
}

// ── Dev server readiness ──────────────────────────────────

async function waitForDevServer(url, retries = 60) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url);
            if (res.ok) return;
        } catch { /* server not up yet */ }
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Dev server at ${url} did not start in time`);
}

// ── Worker pools (lazy to lower idle RAM) ─────────────────

function getIngestionPool() {
    if (!ingestionPool) {
        const ingestionScript = path.join(__dirname, '../workers/ingestion.worker.js');
        ingestionPool = new WorkerPool(ingestionScript, INGESTION_POOL_SIZE);
        console.log('[Main] Ingestion worker pool ready:', ingestionPool.stats);
    }
    return ingestionPool;
}

function getQueryPool() {
    if (!queryPool) {
        const queryScript = path.join(__dirname, '../workers/query.worker.js');
        queryPool = new WorkerPool(queryScript, QUERY_POOL_SIZE);
        console.log('[Main] Query worker pool ready:', queryPool.stats);
    }
    return queryPool;
}

// ── IPC handlers ──────────────────────────────────────────


function registerIPC() {
    // Chat sessions list (creates a default chat if DB is empty)
    ipcMain.handle('chat:list', async () => {
        return ensureDefaultChat();
    });

    ipcMain.handle('chat:create', async (_event, payload = {}) => {
        const chat = createChatSession({ title: payload.title || 'New chat' });
        broadcastChatListUpdated();
        if (payload.select !== false) broadcastChatSelected(chat.id);
        return chat;
    });

    ipcMain.handle('chat:get', async (_event, chatId) => {
        return getChatSession(chatId);
    });

    ipcMain.handle('chat:rename', async (_event, chatId, title) => {
        const updated = renameChatSession(chatId, title);
        broadcastChatListUpdated();
        return updated;
    });

    ipcMain.handle('chat:pin', async (_event, chatId, isPinned) => {
        const updated = setChatPinned(chatId, isPinned);
        broadcastChatListUpdated();
        return updated;
    });

    ipcMain.handle('chat:delete', async (_event, chatId) => {
        deleteChatSession(chatId);
        const chats = ensureDefaultChat();
        broadcastChatListUpdated();
        if (chats.length > 0) broadcastChatSelected(chats[0].id);
        return { success: true };
    });

    ipcMain.handle('chat:addMessage', async (_event, payload) => {
        const updated = addChatMessage(payload);
        broadcastChatListUpdated();
        return updated;
    });

    ipcMain.handle('chat:setSummary', async (_event, chatId, summary) => {
        const updated = setChatSummary(chatId, summary);
        broadcastChatListUpdated();
        return updated;
    });

    ipcMain.handle('chat:touch', async (_event, chatId) => {
        const touched = touchChatSession(chatId);
        broadcastChatListUpdated();
        return touched;
    });

    ipcMain.handle('chat:truncate', async (_event, chatId, keepCount) => {
        return truncateChatMessages(chatId, keepCount);
    });

    ipcMain.handle('chat:setTurnVersions', async (_event, chatId, turnVersionsJson) => {
        return setChatTurnVersions(chatId, turnVersionsJson);
    });

    ipcMain.on('chat:select', (_event, chatId) => {
        broadcastChatSelected(chatId);
    });

    // Run full ingestion pipeline
    ipcMain.handle('pipeline:run', (_event, opts) => {
        return getIngestionPool().exec({ type: 'runPipeline', data: { opts } }, { priority: 1 });
    });

    // Run a single pipeline stage
    ipcMain.handle('pipeline:stage', (_event, stage, data) => {
        return getIngestionPool().exec({ type: stage, data }, { priority: 2 });
    });

    // Query: embed text + search ChromaDB
    ipcMain.handle('query:search', (_event, query, topK) => {
        return getQueryPool().exec({ type: 'queryChroma', data: { query, topK } }, { priority: 7 });
    });

    // Chat: retrieve RAG context only - LLM streaming is handled by WebLLM in the renderer
    // mode: 'ask' (lightweight) or 'research' (full pipeline when needed)
    ipcMain.handle('query:context', async (event, { messages, chatId, topK, mode }) => {
        const RELEVANCE_THRESHOLD = 0.45;

        try {
            const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
            if (!lastUserMsg) throw new Error('No user message found');

            const k = topK || 5;

            // 0. Rewrite query using full conversation history from SQLite
            //    when available, so follow-ups like "any alternatives?" resolve
            //    to the original topic.
            let historyMessages = messages;
            if (chatId) {
                try {
                    const chat = getChatSession(chatId);
                    if (chat?.messages?.length > 0) {
                        historyMessages = chat.messages.map(m => ({ role: m.role, content: m.content }));
                    }
                } catch (_) { /* fall back to provided messages */ }
            }
            const searchQuery = rewriteQuery(historyMessages);
            console.log('[Context] Search query:', searchQuery);

            // 1. Determine if search is needed
            const needsSearch = requiresSearch(searchQuery);
            const needsFreshDataExplicit = needsSearch && requiresFreshData(searchQuery);

            let contextChunks = [];

            if (!needsSearch) {
                // Pure conversational — return immediately so the model starts without delay
                console.log('[Context] Conversational query — skipping search.');

            } else if (mode === 'research') {
                // ── Research mode: wait for full web pipeline ────────────────
                // The scraped content IS the answer, so the wait is intentional.
                const MIN_CHUNKS = 2;
                let relevant = [];

                if (!needsFreshDataExplicit) {
                    event.sender.send('chat:status', 'Checking existing knowledge…');
                    try {
                        contextChunks = await getQueryPool().exec({
                            type: 'retrieveContext',
                            data: { query: searchQuery, topK: k },
                        }, { priority: 8 }) ?? [];
                        console.log('[Context] ChromaDB returned', contextChunks.length, 'chunk(s)');
                    } catch (e) {
                        console.warn('[Context] ChromaDB retrieval failed:', e.message);
                    }
                    relevant = contextChunks.filter(c => c.distance != null && c.distance < RELEVANCE_THRESHOLD);
                }

                if (relevant.length < MIN_CHUNKS || needsFreshDataExplicit) {
                    event.sender.send('chat:status', 'Searching & scraping the web for deep research…');
                    try {
                        const webResults = await getIngestionPool().exec({
                            type: 'researchFetch',
                            data: { keyword: searchQuery, maxPages: 5 },
                        }, { priority: 5 });
                        contextChunks = webResults.map(p => ({ id: p.url, title: p.title, url: p.url, text: p.text, distance: null }));
                    } catch (e) {
                        console.warn('[Context] Research fetch failed:', e.message);
                        contextChunks = relevant;
                    }
                } else {
                    contextChunks = relevant;
                }

            } else {
                // ── Ask mode: return as fast as possible ─────────────────────
                // Only hit ChromaDB (fast, ~100 ms). Never block on a web search
                // here — the LLM starts the moment we return. Users who need
                // fresh web-sourced answers should switch to Research mode.
                if (!needsFreshDataExplicit) {
                    event.sender.send('chat:status', 'Checking existing knowledge…');
                    try {
                        const allChunks = await getQueryPool().exec({
                            type: 'retrieveContext',
                            data: { query: searchQuery, topK: k },
                        }, { priority: 8 }) ?? [];
                        contextChunks = allChunks.filter(c => c.distance != null && c.distance < RELEVANCE_THRESHOLD);
                        console.log('[Context] Ask mode — ChromaDB relevant chunks:', contextChunks.length);
                    } catch (e) {
                        console.warn('[Context] ChromaDB retrieval failed:', e.message);
                    }
                }
                // If no local context the model answers from its own weights — that
                // is still better than making the user wait 3-10 s for a web search.
            }

            // 2. Build system prompt with retrieved context
            event.sender.send('chat:status', '');
            const systemPrompt = buildSystemPrompt(contextChunks);

            return {
                success: true,
                systemPrompt,
                sources: contextChunks.map(c => ({ title: c.title, url: c.url })),
            };
        } catch (err) {
            console.error('[Context] Error:', err?.message || err);
            event.sender.send('chat:error', err?.message || String(err));
            return { success: false, error: err?.message || String(err) };
        }
    });

    // Handle 'New Chat' signals from any frontend slice (like Navbar)
    ipcMain.on('chat:triggerNew', (event) => {
        const chat = createChatSession({ title: 'New chat' });
        broadcastChatListUpdated();
        broadcastChatSelected(chat.id);
    });

    // Quick web search – used when the model decides it needs current info in ask mode
    ipcMain.handle('query:websearch', async (_event, query, maxPages = 3, requestId) => {
        const effectiveRequestId = requestId || `websearch:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        const existing = webSearchRequests.get(effectiveRequestId);
        if (existing) {
            if (existing.response) return existing.response;
            return existing.promise;
        }

        console.log(`[WebSearch] Request: "${query}" (maxPages: ${maxPages}, requestId: ${effectiveRequestId})`);
        const pool = getIngestionPool();
        const startedAt = Date.now();

        const makeResponse = (status, reason, results = []) => ({
            status,
            reason,
            results,
            meta: {
                query,
                maxPages,
                requestId: effectiveRequestId,
                elapsedMs: Date.now() - startedAt,
                resultCount: results.length,
            },
        });

        // Allow a small queue for interactive requests; reject only if queue is saturated.
        if (pool.stats.queued >= INTERACTIVE_MAX_QUEUE_DEPTH) {
            console.warn(`[WebSearch] Queue saturated (${pool.stats.queued}) — rejecting interactive request.`);
            const response = {
                ...makeResponse('busy', 'ingestion queue saturated', []),
                meta: {
                    ...makeResponse('busy', 'ingestion queue saturated', []).meta,
                    pool: pool.stats,
                },
            };
            webSearchRequests.set(effectiveRequestId, {
                requestId: effectiveRequestId,
                status: 'busy',
                response,
                promise: Promise.resolve(response),
            });
            scheduleWebSearchCleanup(effectiveRequestId);
            return response;
        }

        const entry = {
            requestId: effectiveRequestId,
            status: 'running',
            response: null,
            promise: null,
        };
        webSearchRequests.set(effectiveRequestId, entry);

        entry.promise = pool.exec({
                type: 'quickSearch',
                data: { keyword: query, maxPages },
            }, { priority: 10, requestId: effectiveRequestId })
            .then((webResults) => {
                if (entry.status === 'canceled') return entry.response;
                console.log(`[WebSearch] Completed: ${(webResults ?? []).length} result(s)`);
                const results = (webResults ?? []).map(p => ({ title: p.title, url: p.url, text: p.text }));
                enqueuePromotion(query, results);
                entry.status = 'completed';
                entry.response = makeResponse('completed', '', results);
                scheduleWebSearchCleanup(effectiveRequestId);
                return entry.response;
            })
            .catch((e) => {
                if (entry.status === 'canceled' && entry.response) return entry.response;
                console.warn('[WebSearch] Failed:', e.message);
                entry.status = 'failed';
                entry.response = makeResponse('failed', e.message, []);
                scheduleWebSearchCleanup(effectiveRequestId);
                return entry.response;
            });

        return entry.promise;
    });

    ipcMain.handle('query:websearchStatus', async (_event, requestId) => {
        const entry = webSearchRequests.get(requestId);
        if (!entry) {
            return { status: 'unknown', requestId, response: null };
        }
        return {
            status: entry.status,
            requestId,
            response: entry.response,
        };
    });

    ipcMain.handle('query:cancelWebsearch', async (_event, requestId) => {
        const entry = webSearchRequests.get(requestId);
        if (!entry) return { success: false, status: 'unknown' };
        if (entry.status !== 'running') {
            return { success: false, status: entry.status };
        }

        entry.status = 'canceled';
        entry.response = {
            status: 'canceled',
            reason: 'renderer timeout cancellation',
            results: [],
            meta: {
                requestId,
                elapsedMs: 0,
            },
        };

        const canceled = await getIngestionPool().cancel(requestId, 'renderer timeout cancellation');
        scheduleWebSearchCleanup(requestId);
        return { success: canceled, status: canceled ? 'canceled' : 'running' };
    });

    // Batched web search – multiple queries, ONE browser launch, shared page budget
    ipcMain.handle('query:batchWebsearch', async (_event, queries, maxTotalPages = 5) => {
        console.log(`[BatchWebSearch] Request: ${queries.length} queries (maxTotalPages: ${maxTotalPages})`);
        const pool = getIngestionPool();
        const startedAt = Date.now();

        if (pool.stats.queued >= INTERACTIVE_MAX_QUEUE_DEPTH) {
            console.warn(`[BatchWebSearch] Queue saturated (${pool.stats.queued}) — rejecting interactive request.`);
            return {
                status: 'busy',
                reason: 'ingestion queue saturated',
                results: [],
                meta: {
                    queries,
                    maxTotalPages,
                    elapsedMs: Date.now() - startedAt,
                    pool: pool.stats,
                },
            };
        }

        try {
            const webResults = await pool.exec({
                type: 'batchQuickSearch',
                data: { queries, maxTotalPages },
            }, { priority: 10 });
            console.log(`[BatchWebSearch] Completed: ${(webResults ?? []).length} result(s)`);
            const results = (webResults ?? []).map(p => ({ title: p.title, url: p.url, text: p.text }));
            return {
                status: 'completed',
                reason: '',
                results,
                meta: {
                    queries,
                    maxTotalPages,
                    elapsedMs: Date.now() - startedAt,
                    resultCount: results.length,
                },
            };
        } catch (e) {
            console.warn('[BatchWebSearch] Failed:', e.message);
            return {
                status: 'failed',
                reason: e.message,
                results: [],
                meta: {
                    queries,
                    maxTotalPages,
                    elapsedMs: Date.now() - startedAt,
                },
            };
        }
    });

    // Fetch a specific URL – used when the model decides to read a user-provided source
    ipcMain.handle('query:fetchUrl', async (_event, url) => {
        try {
            const result = await getIngestionPool().exec({
                type: 'fetchUrl',
                data: { url },
            }, { priority: 9 });
            return result ?? null;
        } catch (e) {
            console.warn('[FetchUrl] Failed:', e.message);
            return null;
        }
    });

    // Worker pool stats
    ipcMain.handle('pool:stats', () => ({
        ingestion: ingestionPool ? ingestionPool.stats : { total: 0, idle: 0, busy: 0, queued: 0 },
        query: queryPool ? queryPool.stats : { total: 0, idle: 0, busy: 0, queued: 0 },
    }));

    // Profile
    ipcMain.handle('profile:get', () => getProfile());
    ipcMain.handle('profile:set', (_event, updates) => setProfile(updates));

    // Clipboard utils
    ipcMain.on('utils:copy-to-clipboard', (_event, text) => {
        clipboard.writeText(text);
    });
}

// ── Lifecycle ─────────────────────────────────────────────

app.whenReady().then(async () => {
    registerIPC();

    // Start configured background services.
    try {
        const autostartServices = parseAutostartServiceList();
        if (autostartServices.length > 0) {
            await ServiceManager.startAll({ include: autostartServices });
        }
    } catch (err) {
        console.warn('[Main] ServiceManager autostart failed:', err?.message || err);
    }

    if (isDev) {
        try {
            await waitForDevServer(DEV_URL);
        } catch (err) {
            console.error('[Main] Failed to connect to renderer dev server:', err?.message || err);
            app.exit(1);
            return;
        }
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
}).catch((err) => {
    console.error('[Main] Fatal startup error:', err?.message || err);
    app.exit(1);
});

app.on('window-all-closed', async () => {
    await ingestionPool?.destroy();
    await queryPool?.destroy();
    try {
        await ServiceManager.stopAll();
    } catch (err) {
        console.warn('[Main] ServiceManager failed to stop services:', err?.message || err);
    }
    if (process.platform !== 'darwin') app.quit();
});
