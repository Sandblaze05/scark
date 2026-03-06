/**
 * Query Worker
 *
 * Runs inside a worker thread managed by WorkerPool.
 * Handles embedding a query and searching for similar chunks.
 *
 * Supported task types:
 *   queryChroma  – embed query string → search ChromaDB (vector store)
 *   localSearch  – embed query string → in-memory cosine search over results.json
 */

import { parentPort } from 'worker_threads';
import { embedText, search as localSearch } from '../services/embedService.js';
import { queryChroma } from '../services/chromaService.js';

const handlers = {
    /**
     * Embed a query and search ChromaDB for the top-k nearest chunks.
     */
    async queryChroma({ query, topK = 5 }) {
        const queryVec = await embedText(query);
        const results = await queryChroma(queryVec, topK);
        return results;
    },

    /**
     * In-memory cosine-similarity search over embeddings in results.json.
     */
    async localSearch({ query, topK = 5 }) {
        return await localSearch(query, topK);
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
