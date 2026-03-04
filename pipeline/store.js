/**
 * Pipeline Stage 6 – Store (Vector DB + relational metadata)
 *
 * Persists embedded, chunked pages into ChromaDB (vectors) and SQLite
 * (metadata / text) in parallel.
 *
 * Data contract
 * ─────────────
 *   Input :  EmbeddedPage[]  (from embedder stage)
 *   Output:  { chroma: number, sqlite: { pages, chunks } }
 */

import { storeInChroma }                 from '../services/chromaService.js';
import { storeInSQLite, getExistingUrls } from '../services/sqliteService.js';

/**
 * Persist results to both ChromaDB and SQLite concurrently.
 *
 * @param {Array} embeddedPages
 * @returns {Promise<{ chroma: number, sqlite: { pages: number, chunks: number } }>}
 */
export async function store(embeddedPages) {
    if (embeddedPages.length === 0) {
        console.log('[Store] Nothing to store.');
        return { chroma: 0, sqlite: { pages: 0, chunks: 0 } };
    }

    console.log(`[Store] Persisting ${embeddedPages.length} page(s) to ChromaDB + SQLite…`);

    const [chromaCount, sqliteStats] = await Promise.all([
        storeInChroma(embeddedPages),
        Promise.resolve(storeInSQLite(embeddedPages)),
    ]);

    console.log('[Store] Done.');
    return { chroma: chromaCount, sqlite: sqliteStats };
}

/**
 * Return URLs already in the SQLite store (useful for crawl-skip logic).
 *
 * @returns {Set<string>}
 */
export { getExistingUrls } from '../services/sqliteService.js';
