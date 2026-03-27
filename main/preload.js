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
        websearch: (query, maxPages, requestId) => ipcRenderer.invoke('query:websearch', query, maxPages, requestId),

        /** Get current status for an in-flight async task */
        taskStatus: (requestId) => ipcRenderer.invoke('query:taskStatus', requestId),

        /** Cancel an in-flight async task */
        cancelTask: (requestId) => ipcRenderer.invoke('query:cancelTask', requestId),

        /** Batched web search: multiple queries, one browser, shared page budget */
        batchWebsearch: (queries, maxTotalPages) => ipcRenderer.invoke('query:batchWebsearch', queries, maxTotalPages),

        /** Fetch and read a specific URL (returns { title, text } or null) */
        fetchUrl: (url, requestId) => ipcRenderer.invoke('query:fetchUrl', url, requestId),
    },

    chat: {
        /** List chat sessions (auto-creates one if empty) */
        list: () => ipcRenderer.invoke('chat:list'),

        /** Create a fresh chat session */
        create: (payload) => ipcRenderer.invoke('chat:create', payload),

        /** Load one chat with its messages */
        get: (chatId) => ipcRenderer.invoke('chat:get', chatId),

        /** Rename a chat session */
        rename: (chatId, title) => ipcRenderer.invoke('chat:rename', chatId, title),

        /** Pin or unpin a chat session */
        pin: (chatId, isPinned) => ipcRenderer.invoke('chat:pin', chatId, isPinned),

        /** Delete a chat session */
        remove: (chatId) => ipcRenderer.invoke('chat:delete', chatId),

        /** Persist one chat message */
        addMessage: (payload) => ipcRenderer.invoke('chat:addMessage', payload),

        /** Persist rolling chat summary */
        setSummary: (chatId, summary) => ipcRenderer.invoke('chat:setSummary', chatId, summary),

        /** Touch chat last-active timestamp */
        touch: (chatId) => ipcRenderer.invoke('chat:touch', chatId),

        /** Select an existing chat session */
        select: (chatId) => ipcRenderer.send('chat:select', chatId),

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

        /** Register a callback for selected chat changes */
        onSelected: (cb) => {
            const handler = (_e, chatId) => cb(chatId);
            ipcRenderer.on('chat:selected', handler);
            return () => ipcRenderer.removeListener('chat:selected', handler);
        },

        /** Register a callback for chat list updates */
        onListUpdated: (cb) => {
            const handler = (_e, chats) => cb(chats);
            ipcRenderer.on('chat:list-updated', handler);
            return () => ipcRenderer.removeListener('chat:list-updated', handler);
        },

        /** Delete messages after keepCount in the DB (used for editing a previous message) */
        truncate: (chatId, keepCount) => ipcRenderer.invoke('chat:truncate', chatId, keepCount),

        /** Save the JSON string representing the turnVersions Map to SQLite */
        setTurnVersions: (chatId, versionsJson) => ipcRenderer.invoke('chat:setTurnVersions', chatId, versionsJson),
    },

    pool: {
        /** Get worker pool stats (idle/busy/queued counts) */
        stats: () => ipcRenderer.invoke('pool:stats'),
    },

    utils: {
        /** 
         * Copy text to the system clipboard using Electron's native API.
         * Bypasses renderer/Web API permission issues.
         */
        copyToClipboard: (text) => ipcRenderer.send('utils:copy-to-clipboard', text),
    },

    profile: {
        /** Get the saved user profile object */
        get: () => ipcRenderer.invoke('profile:get'),
        /** Persist profile field updates { fullName, displayName, workFunction, preferences } */
        set: (updates) => ipcRenderer.invoke('profile:set', updates),
    },
});
