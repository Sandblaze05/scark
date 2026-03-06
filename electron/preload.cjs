/**
 * Electron Preload – CJS (required for sandbox: true)
 *
 * Exposes a safe `window.scark` API to the renderer via contextBridge.
 * The renderer never gets direct access to Node.js or Electron internals.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scark', {
    pipeline: {
        /** Run the full ingestion pipeline (seed → crawl → clean → chunk → embed → store) */
        run: (opts) => ipcRenderer.invoke('pipeline:run', opts),

        /** Run an individual pipeline stage: seedSearch | crawl | clean | chunk | embed | store */
        stage: (stage, data) => ipcRenderer.invoke('pipeline:stage', stage, data),
    },

    query: {
        /** Embed query + search ChromaDB for top-k similar chunks */
        search: (query, topK) => ipcRenderer.invoke('query:search', query, topK),

        /** In-memory search over results.json embeddings */
        local: (query, topK) => ipcRenderer.invoke('query:local', query, topK),
    },

    pool: {
        /** Get worker pool stats (idle/busy/queued counts) */
        stats: () => ipcRenderer.invoke('pool:stats'),
    },
});
