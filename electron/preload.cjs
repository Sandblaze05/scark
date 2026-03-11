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

        /** Quick web search triggered when the model requests current information */
        websearch: (query, maxPages) => ipcRenderer.invoke('query:websearch', query, maxPages),

        /** Batched web search: multiple queries, one browser, shared page budget */
        batchWebsearch: (queries, maxTotalPages) => ipcRenderer.invoke('query:batchWebsearch', queries, maxTotalPages),

        /** Fetch and read a specific URL (returns { title, text } or null) */
        fetchUrl: (url) => ipcRenderer.invoke('query:fetchUrl', url),
    },

    chat: {
        /**
         * Retrieve RAG context for the conversation.
         * Returns { success, systemPrompt, sources }.
         * LLM streaming is performed locally via WebLLM in the renderer.
         */
        getContext: (data) => ipcRenderer.invoke('query:context', data),

        /** Register a callback for status updates during context retrieval */
        onStatus: (cb) => {
            const handler = (_e, status) => cb(status);
            ipcRenderer.on('chat:status', handler);
            return () => ipcRenderer.removeListener('chat:status', handler);
        },

        /** Register a callback for context/pipeline errors */
        onError: (cb) => {
            const handler = (_e, error) => cb(error);
            ipcRenderer.on('chat:error', handler);
            return () => ipcRenderer.removeListener('chat:error', handler);
        },

        /** Dispatch New Chat Reset signal */
        triggerNew: () => ipcRenderer.send('chat:triggerNew'),

        /** Register a callback for New Chat clicks */
        onNew: (cb) => {
            const handler = () => cb();
            ipcRenderer.on('chat:new', handler);
            return () => ipcRenderer.removeListener('chat:new', handler);
        },
    },

    pool: {
        /** Get worker pool stats (idle/busy/queued counts) */
        stats: () => ipcRenderer.invoke('pool:stats'),
    },
});
