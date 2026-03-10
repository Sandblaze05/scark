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
    },

    chat: {
        /** Start a RAG chat: retrieve context + stream LLM response */
        send: (data) => ipcRenderer.invoke('query:chat', data),

        /** Register a callback for each streamed token */
        onToken: (cb) => {
            const handler = (_e, token) => cb(token);
            ipcRenderer.on('chat:token', handler);
            return () => ipcRenderer.removeListener('chat:token', handler);
        },

        /** Register a callback for stream completion */
        onDone: (cb) => {
            const handler = () => cb();
            ipcRenderer.on('chat:done', handler);
            return () => ipcRenderer.removeListener('chat:done', handler);
        },

        /** Register a callback for stream errors */
        onError: (cb) => {
            const handler = (_e, error) => cb(error);
            ipcRenderer.on('chat:error', handler);
            return () => ipcRenderer.removeListener('chat:error', handler);
        },

        /** Register a callback for status updates (pipeline progress) */
        onStatus: (cb) => {
            const handler = (_e, status) => cb(status);
            ipcRenderer.on('chat:status', handler);
            return () => ipcRenderer.removeListener('chat:status', handler);
        },
    },

    pool: {
        /** Get worker pool stats (idle/busy/queued counts) */
        stats: () => ipcRenderer.invoke('pool:stats'),
    },
});
