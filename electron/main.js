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

    // Query: in-memory search over results.json
    ipcMain.handle('query:local', (_event, query, topK) => {
        return queryPool.exec({ type: 'localSearch', data: { query, topK } });
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
