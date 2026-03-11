/**
 * Electron Main Process
 *
 * - Spawns the BrowserWindow loading Next.js (dev server or static export)
 * - Initialises worker pools for ingestion and query pipelines
 * - Exposes IPC handlers so the renderer can drive pipelines and queries
 */

import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { WorkerPool } from '../workers/pool.js';
import { buildSystemPrompt, rewriteQuery, requiresFreshData, requiresSearch } from '../services/chatService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:3000';

// ── GPU selection ─────────────────────────────────────────
// Request the high-performance discrete GPU on multi-GPU laptops.
// These switches must be set before the GPU process is spawned (i.e. before app ready).
// WebLLM uses WebGPU via Dawn/D3D12 — no ANGLE override needed or safe here.
app.commandLine.appendSwitch('force_high_performance_gpu');

let mainWindow;
let ingestionPool;
let queryPool;

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

// ── Worker pools ──────────────────────────────────────────

function initWorkerPools() {
    const ingestionScript = path.join(__dirname, '../workers/ingestion.worker.js');
    const queryScript = path.join(__dirname, '../workers/query.worker.js');

    ingestionPool = new WorkerPool(ingestionScript, 2);
    queryPool = new WorkerPool(queryScript, 2);

    console.log('[Main] Worker pools ready:', ingestionPool.stats, queryPool.stats);
}

// ── IPC handlers ──────────────────────────────────────────


function registerIPC() {
    // Run full ingestion pipeline
    ipcMain.handle('pipeline:run', (_event, opts) => {
        return ingestionPool.exec({ type: 'runPipeline', data: { opts } });
    });

    // Run a single pipeline stage
    ipcMain.handle('pipeline:stage', (_event, stage, data) => {
        return ingestionPool.exec({ type: stage, data });
    });

    // Query: embed text + search ChromaDB
    ipcMain.handle('query:search', (_event, query, topK) => {
        return queryPool.exec({ type: 'queryChroma', data: { query, topK } });
    });

    // Chat: retrieve RAG context only - LLM streaming is handled by WebLLM in the renderer
    // mode: 'ask' (lightweight) or 'research' (full pipeline when needed)
    ipcMain.handle('query:context', async (event, { messages, topK, mode }) => {
        const RELEVANCE_THRESHOLD = 0.45;

        try {
            const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
            if (!lastUserMsg) throw new Error('No user message found');

            const k = topK || 5;

            // 0. Rewrite query (heuristic only — LLM no longer in main process)
            const searchQuery = rewriteQuery(messages);
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
                        contextChunks = await queryPool.exec({
                            type: 'retrieveContext',
                            data: { query: searchQuery, topK: k },
                        }) ?? [];
                        console.log('[Context] ChromaDB returned', contextChunks.length, 'chunk(s)');
                    } catch (e) {
                        console.warn('[Context] ChromaDB retrieval failed:', e.message);
                    }
                    relevant = contextChunks.filter(c => c.distance != null && c.distance < RELEVANCE_THRESHOLD);
                }

                if (relevant.length < MIN_CHUNKS || needsFreshDataExplicit) {
                    event.sender.send('chat:status', 'Searching & scraping the web for deep research…');
                    try {
                        const webResults = await ingestionPool.exec({
                            type: 'researchFetch',
                            data: { keyword: searchQuery, maxPages: 5 },
                        });
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
                        const allChunks = await queryPool.exec({
                            type: 'retrieveContext',
                            data: { query: searchQuery, topK: k },
                        }) ?? [];
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
        // Stop any ongoing stream
        if (currentChatAbortController) {
            currentChatAbortController.abort();
            currentChatAbortController = null;
        }
        // Broadcast reset to all windows
        BrowserWindow.getAllWindows().forEach(win => win.webContents.send('chat:new'));
    });

    // Quick web search – used when the model decides it needs current info in ask mode
    ipcMain.handle('query:websearch', async (_event, query, maxPages = 3) => {
        try {
            const webResults = await ingestionPool.exec({
                type: 'quickSearch',
                data: { keyword: query, maxPages },
            });
            return (webResults ?? []).map(p => ({ title: p.title, url: p.url, text: p.text }));
        } catch (e) {
            console.warn('[WebSearch] Failed:', e.message);
            return [];
        }
    });

    // Batched web search – multiple queries, ONE browser launch, shared page budget
    ipcMain.handle('query:batchWebsearch', async (_event, queries, maxTotalPages = 5) => {
        try {
            const webResults = await ingestionPool.exec({
                type: 'batchQuickSearch',
                data: { queries, maxTotalPages },
            });
            return (webResults ?? []).map(p => ({ title: p.title, url: p.url, text: p.text }));
        } catch (e) {
            console.warn('[BatchWebSearch] Failed:', e.message);
            return [];
        }
    });

    // Fetch a specific URL – used when the model decides to read a user-provided source
    ipcMain.handle('query:fetchUrl', async (_event, url) => {
        try {
            const result = await ingestionPool.exec({
                type: 'fetchUrl',
                data: { url },
            });
            return result ?? null;
        } catch (e) {
            console.warn('[FetchUrl] Failed:', e.message);
            return null;
        }
    });

    // Worker pool stats
    ipcMain.handle('pool:stats', () => ({
        ingestion: ingestionPool.stats,
        query: queryPool.stats,
    }));
}

// ── Lifecycle ─────────────────────────────────────────────

app.whenReady().then(async () => {
    initWorkerPools();
    registerIPC();

    if (isDev) {
        await waitForDevServer(DEV_URL);
    }
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', async () => {
    await ingestionPool?.destroy();
    await queryPool?.destroy();
    if (process.platform !== 'darwin') app.quit();
});
