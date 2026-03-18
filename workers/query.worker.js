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
import { getChunkById, getPageText, searchChunksLexical } from '../services/sqliteService.js';

const MIN_LEXICAL_HITS = parseInt(process.env.SCARK_RAG_MIN_LEXICAL_HITS || '3', 10);
const LEXICAL_LIMIT = parseInt(process.env.SCARK_RAG_LEXICAL_TOPK || '8', 10);

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
        const contextChunks = [];
        const lexical = searchChunksLexical(query, Math.max(topK, LEXICAL_LIMIT));
        for (const row of lexical) {
            contextChunks.push({
                id: row.id,
                title: row.title,
                url: row.url,
                text: row.text,
                timestamp: row.timestamp,
                distance: null,
                retrieval: 'lexical',
            });
        }
        console.log(`[QueryWorker] SQLite lexical returned ${lexical.length} result(s)`);

        if (lexical.length >= Math.min(topK, MIN_LEXICAL_HITS)) {
            return contextChunks.slice(0, topK);
        }

        const neededVector = Math.max(1, topK - contextChunks.length);
        const queryVec = await embedText(query);
        console.log(`[QueryWorker] Querying ChromaDB fallback (topK=${neededVector}, vecLen=${queryVec?.length})`);
        const chromaResults = await searchChroma(queryVec, Math.max(topK, neededVector));
        const ids = chromaResults?.ids?.[0] ?? [];
        console.log(`[QueryWorker] ChromaDB returned ${ids.length} result(s)`);

        const seen = new Set(contextChunks.map((c) => c.id));

        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            if (seen.has(id)) continue;
            const chunk = getChunkById(id);
            const page = getPageText(id);

            contextChunks.push({
                id,
                title:     page?.title ?? '',
                url:       page?.url ?? id.split('::')[0],
                text:      chunk?.text ?? chromaResults.documents[0][i] ?? '',
                timestamp: chunk?.timestamp ?? null,
                distance:  chromaResults.distances?.[0]?.[i] ?? null,
                retrieval: 'vector',
            });
            seen.add(id);
            if (contextChunks.length >= topK) break;
        }

        return contextChunks.slice(0, topK);
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
