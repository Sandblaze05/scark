/**
 * Pipeline Orchestrator
 *
 * Wires every stage together into a single end-to-end run:
 *
 *   User query → Seed search → Crawler workers → Cleaner
 *              → Chunker → Embedding workers → Vector DB
 *
 * Each stage is independently importable so external workers can invoke
 * them in isolation (e.g. a crawl-only worker, or an embed-only worker).
 *
 * Re-exports every stage for convenience:
 *   import { seedSearch, crawl, cleanPages, chunkPages, embed, store } from './pipeline/index.js';
 */

// ── Re-exports (for workers that only need one stage) ─────
export { seedSearch }                        from './seedSearch.js';
export { crawl }                             from './crawler.js';
export { cleanPage, cleanPages }             from './cleaner.js';
export { chunkText, chunkPage, chunkPages }  from './chunker.js';
export { embed }                             from './embedder.js';
export { store, getExistingUrls, getPageText } from './store.js';
export * as config                           from './config.js';

// ── Stage imports for the orchestrator ────────────────────
import { seedSearch }            from './seedSearch.js';
import { crawl }                 from './crawler.js';
import { cleanPages }            from './cleaner.js';
import { chunkPages }            from './chunker.js';
import { embed }                 from './embedder.js';
import { store, getExistingUrls } from './store.js';

/**
 * Run the full pipeline end-to-end.
 *
 * @param {import('playwright-core').Browser} browser
 * @param {object} [opts]               – per-stage overrides
 * @param {object} [opts.seed]          – seedSearch options
 * @param {object} [opts.crawler]       – crawler options
 * @param {object} [opts.cleaner]       – cleaner options
 * @param {object} [opts.chunker]       – chunker options
 * @returns {Promise<{ pages: Array, stats: object }>}
 */
export async function runPipeline(browser, opts = {}) {
    // ── 1. Seed search ────────────────────────────────────
    const seedUrls = await seedSearch(browser, opts.seed);
    if (seedUrls.length === 0) {
        console.log('[Pipeline] Aborting – no seed URLs.');
        return { pages: [], stats: {} };
    }

    // ── 2. Load cache (skip already-stored URLs) ──────────
    const cachedUrls = getExistingUrls();
    if (cachedUrls.size > 0) {
        console.log(`[Pipeline] ${cachedUrls.size} URL(s) already in DB – will skip.`);
    }

    // ── 3. Crawl ──────────────────────────────────────────
    const rawPages = await crawl(browser, seedUrls, {
        ...opts.crawler,
        skipUrls: cachedUrls,
    });

    // ── 4. Clean ──────────────────────────────────────────
    const cleanedPages = cleanPages(rawPages, opts.cleaner);

    // ── 5. Chunk ──────────────────────────────────────────
    const chunkedPages = chunkPages(cleanedPages, opts.chunker);

    // Filter out pages whose URLs were already stored
    const newPages = chunkedPages.filter(p => !cachedUrls.has(p.url));
    const skipped  = chunkedPages.length - newPages.length;
    if (skipped > 0) console.log(`[Pipeline] Skipped ${skipped} cached page(s).`);

    // ── 6. Embed ──────────────────────────────────────────
    await embed(newPages);

    // ── 7. Store ──────────────────────────────────────────
    const storeStats = await store(newPages);

    console.log('[Pipeline] Complete.');
    return {
        pages: chunkedPages,   // all (including cached) for output
        newPages,              // only newly processed
        stats: storeStats,
    };
}
