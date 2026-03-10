/**
 * Electron Main Process
 *
 * - Spawns the BrowserWindow loading Next.js (dev server or static export)
 * - Initialises worker pools for ingestion and query pipelines
 * - Exposes IPC handlers so the renderer can drive pipelines and queries
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { WorkerPool } from '../workers/pool.js';
import { buildSystemPrompt, streamChat, rewriteQuery } from '../services/chatService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:3000';

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
            sandbox: true,
        },
    });

    mainWindow.setMenuBarVisibility(false)

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

    // Chat: RAG → stream LLM response
    // mode: 'ask' (lightweight) or 'research' (full pipeline when needed)
    ipcMain.handle('query:chat', async (event, { messages, topK, mode }) => {
        const RELEVANCE_THRESHOLD = 0.45;
        const MIN_CHUNKS = 2;

        try {
            const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
            if (!lastUserMsg) throw new Error('No user message found');

            const k = topK || 5;

            // 0. Rewrite query: resolve pronouns/context from conversation history
            event.sender.send('chat:status', 'Understanding your question…');
            const searchQuery = await rewriteQuery(messages);
            console.log(`[Chat] Search query: "${searchQuery}"`);

            // 1. Try retrieving context from existing RAG store
            event.sender.send('chat:status', 'Checking existing knowledge…');
            let contextChunks = [];
            try {
                contextChunks = await queryPool.exec({
                    type: 'retrieveContext',
                    data: { query: searchQuery, topK: k },
                }) ?? [];
                console.log(`[Chat] ChromaDB retrieval returned ${contextChunks.length} chunk(s)`);
                if (contextChunks.length > 0) {
                    const best = contextChunks[0].distance;
                    const worst = contextChunks[contextChunks.length - 1].distance;
                    console.log(`[Chat] Distance range: ${best?.toFixed(4)} – ${worst?.toFixed(4)} (threshold ${RELEVANCE_THRESHOLD})`);
                }
            } catch (retrieveErr) {
                console.warn('[Chat] ChromaDB retrieval failed:', retrieveErr.message);
            }

            // 2. Filter to relevant chunks
            const relevant = contextChunks.filter(
                c => c.distance != null && c.distance < RELEVANCE_THRESHOLD,
            );

            // 3. In 'research' mode, run full pipeline if context is insufficient
            if (mode === 'research') {
                const needsFreshData = relevant.length < MIN_CHUNKS;

                if (needsFreshData) {
                    console.log(
                        `[Chat] Only ${relevant.length}/${contextChunks.length} chunk(s) below threshold ${RELEVANCE_THRESHOLD} — running pipeline`,
                    );
                    event.sender.send('chat:status', 'Searching & scraping the web…');
                    const pipelineResult = await ingestionPool.exec({
                        type: 'runPipeline',
                        data: { opts: { seed: { keyword: searchQuery } } },
                    });
                    console.log('[Chat] Pipeline done:', pipelineResult?.stats);

                    // Re-retrieve after fresh ingestion
                    event.sender.send('chat:status', 'Retrieving context…');
                    try {
                        const freshChunks = await queryPool.exec({
                            type: 'retrieveContext',
                            data: { query: searchQuery, topK: k },
                        }) ?? [];
                        const freshRelevant = freshChunks.filter(
                            c => c.distance != null && c.distance < RELEVANCE_THRESHOLD,
                        );
                        if (freshRelevant.length > relevant.length) {
                            contextChunks = freshChunks;
                        }
                    } catch (err) {
                        console.warn('[Chat] Post-pipeline retrieval failed:', err.message);
                    }
                } else {
                    console.log(
                        `[Chat] ${relevant.length} relevant chunk(s) found in existing store — skipping pipeline`,
                    );
                }
            } else {
                // 'ask' mode — use existing relevant context, or do a quick web search
                if (relevant.length >= MIN_CHUNKS) {
                    contextChunks = relevant;
                    console.log(`[Chat][Ask] Using ${relevant.length} relevant chunk(s) from existing store`);
                } else {
                    console.log(`[Chat][Ask] Insufficient local context (${relevant.length}) — running quick web search`);
                    event.sender.send('chat:status', 'Searching the web…');
                    try {
                        const webResults = await ingestionPool.exec({
                            type: 'quickSearch',
                            data: { keyword: searchQuery, maxPages: 3 },
                        });
                        console.log(`[Chat][Ask] Quick search returned ${webResults.length} page(s)`);
                        contextChunks = webResults.map(p => ({
                            id: p.url,
                            title: p.title,
                            url: p.url,
                            text: p.text,
                            distance: null,
                        }));
                    } catch (err) {
                        console.warn('[Chat][Ask] Quick search failed:', err.message);
                        contextChunks = relevant;
                    }
                }
            }

            console.log(`[Chat] Using ${contextChunks.length} context chunks for LLM`);
            if (contextChunks.length > 0) {
                contextChunks.forEach((c, i) => {
                    console.log(`  [${i + 1}] ${c.title} (${c.text?.length ?? 0} chars, dist: ${c.distance})`);
                });
            } else {
                console.warn('[Chat] WARNING: No context found — model will answer without sources');
            }

            // 4. Build messages with context-aware system prompt
            event.sender.send('chat:status', '');
            const systemPrompt = buildSystemPrompt(contextChunks);
            const fullMessages = [
                { role: 'system', content: systemPrompt },
                ...messages,
            ];

            // 5. Stream tokens from LLM via Ollama
            for await (const token of streamChat(fullMessages)) {
                event.sender.send('chat:token', token);
            }

            event.sender.send('chat:done');

            return {
                success: true,
                sources: contextChunks.map(c => ({ title: c.title, url: c.url })),
            };
        } catch (err) {
            console.error('[Chat] Error:', err.message);
            event.sender.send('chat:error', err.message);
            return { success: false, error: err.message };
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
