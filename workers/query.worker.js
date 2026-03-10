/**
 * Query Worker
 *
 * Runs inside a worker thread managed by WorkerPool.
 * Handles embedding a query and searching for similar chunks.
 *
 * Supported task types:
 *   queryChroma     – embed query string → search ChromaDB (vector store)
 *   retrieveContext – embed query → ChromaDB → SQLite → context objects for LLM
 */

import { parentPort } from 'worker_threads';
import { embedText } from '../services/embedService.js';
import { queryChroma as searchChroma } from '../services/chromaService.js';
import { getChunkById, getPageText } from '../services/sqliteService.js';

const handlers = {
    /**
     * Embed a query and search ChromaDB for the top-k nearest chunks.
     */
    async queryChroma({ query, topK = 5 }) {
        const queryVec = await embedText(query);
        const results = await searchChroma(queryVec, topK);
        return results;
    },

    /**
     * Retrieve context for RAG: embed query → search ChromaDB → fetch
     * chunk text from SQLite.  Returns an array of context objects the
     * main process can feed into the LLM system prompt.
     */
    async retrieveContext({ query, topK = 5 }) {
        const queryVec = await embedText(query);
        console.log(`[QueryWorker] Querying ChromaDB (topK=${topK}, vecLen=${queryVec?.length})`);
        const chromaResults = await searchChroma(queryVec, topK);

        const contextChunks = [];
        const ids = chromaResults?.ids?.[0] ?? [];
        console.log(`[QueryWorker] ChromaDB returned ${ids.length} result(s)`);

        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const chunk = getChunkById(id);
            const page = getPageText(id);

            contextChunks.push({
                id,
                title:    page?.title ?? '',
                url:      page?.url ?? id.split('::')[0],
                text:     chunk?.text ?? chromaResults.documents[0][i] ?? '',
                distance: chromaResults.distances?.[0]?.[i] ?? null,
            });
        }

        return contextChunks;
    },

};

parentPort.on('message', async ({ taskId, type, data }) => {
    try {
        const handler = handlers[type];
        if (!handler) throw new Error(`Unknown query task type: ${type}`);
        const result = await handler(data ?? {});
        parentPort.postMessage({ taskId, result });
    } catch (err) {
        parentPort.postMessage({ taskId, error: err.message });
    }
});
