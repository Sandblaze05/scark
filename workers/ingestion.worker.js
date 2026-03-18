/**
 * Ingestion Worker
 *
 * Runs inside a worker thread managed by WorkerPool.
 * Handles any pipeline stage (or the full pipeline) on demand.
 *
 * Supported task types:
 *   runPipeline  – full end-to-end (seed → store)
 *   seedSearch   – discover seed URLs
 *   crawl        – fetch pages from seed URLs
 *   clean        – extract article text from raw HTML pages
 *   chunk        – split cleaned text into overlapping chunks
 *   embed        – generate embeddings for chunks (via @xenova/transformers)
 *   store        – persist to ChromaDB + SQLite
 */

import { parentPort } from 'worker_threads';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

import { runPipeline }              from '../pipeline/index.js';
import { seedSearch }               from '../pipeline/seedSearch.js';
import { crawl }                    from '../pipeline/crawler.js';
import { cleanPages }               from '../pipeline/cleaner.js';
import { chunkPages }               from '../pipeline/chunker.js';
import { embed }                    from '../pipeline/embedder.js';
import { store }                    from '../pipeline/store.js';

chromium.use(StealthPlugin());

// Background vector-store writes are expensive and can destabilize interactive
// search flows on some Windows/Electron setups. Keep it opt-in.
const ENABLE_BACKGROUND_STORE = /^(1|true)$/i.test(process.env.SCARK_BACKGROUND_STORE || '0');
let backgroundStoreChain = Promise.resolve();

function queueBackgroundStore(cleanedPages, sourceLabel) {
    if (!ENABLE_BACKGROUND_STORE) return;
    if (!Array.isArray(cleanedPages) || cleanedPages.length === 0) return;

    backgroundStoreChain = backgroundStoreChain
        .then(async () => {
            const chunked = chunkPages(cleanedPages, {});
            await embed(chunked);
            await store(chunked);
            console.log(`[Background] Stored ${chunked.length} ${sourceLabel} page(s) to Vector DB.`);
        })
        .catch((e) => {
            console.error(`[Background] Error storing ${sourceLabel} data:`, e);
        });
}

function toPromotedCleanedPages(results = []) {
    return (results || [])
        .filter((r) => typeof r?.url === 'string' && typeof r?.text === 'string' && r.text.trim().length > 80)
        .map((r) => {
            let domain = '';
            try {
                domain = new URL(r.url).hostname;
            } catch {
                domain = '';
            }
            const cleanedText = r.text.replace(/\s+/g, ' ').trim();
            return {
                url: r.url,
                title: r.title || r.url,
                cleanedText,
                metadata: {
                    word_count: cleanedText.split(/\s+/).filter(Boolean).length,
                    domain,
                    keyword_density: 0,
                    timestamp: new Date().toISOString(),
                },
            };
        });
}

// ── Task handlers (one per pipeline stage) ────────────────

const handlers = {
    async runPipeline({ opts }) {
        const browser = await chromium.launch({ headless: true });
        try {
            const result = await runPipeline(browser, opts);
            // Strip non-serialisable fields before sending back
            return {
                pages: result.pages,
                newPages: result.newPages,
                stats: result.stats,
            };
        } finally {
            await browser.close();
        }
    },

    async seedSearch({ opts }) {
        const browser = await chromium.launch({ headless: true });
        try {
            return await seedSearch(browser, opts);
        } finally {
            await browser.close();
        }
    },

    async crawl({ seedUrls, opts }) {
        const browser = await chromium.launch({ headless: true });
        try {
            const rawPages = await crawl(browser, seedUrls, opts);
            // Strip heavy HTML for IPC — downstream stages can re-use if needed
            return rawPages.map(p => ({
                url: p.url,
                title: p.title,
                html: p.html,
                bodyText: p.bodyText,
            }));
        } finally {
            await browser.close();
        }
    },

    clean({ rawPages, opts }) {
        return cleanPages(rawPages, opts);
    },

    chunk({ cleanedPages, opts }) {
        return chunkPages(cleanedPages, opts);
    },

    async embed({ chunkedPages }) {
        await embed(chunkedPages);
        // Strip embedding vectors from result (too large for IPC summary);
        // they're already stored via the store stage.
        return chunkedPages.map(p => ({
            url: p.url,
            title: p.title,
            chunkCount: p.chunks.length,
        }));
    },

    async store({ embeddedPages }) {
        return await store(embeddedPages);
    },

    /**
     * Deep Research fetch: gets raw data directly, and asynchronously puts it in DB
     */
    async researchFetch({ keyword, maxPages }) {
        const max = maxPages || 5;
        const browser = await chromium.launch({ headless: true });
        
        let cleaned = [];
        try {
            const seedUrls = await seedSearch(browser, { keyword, count: max });
            if (seedUrls.length > 0) {
                const rawPages = await crawl(browser, seedUrls, {
                    concurrency: 2,
                    hardMaxPages: max,
                    maxConsecutiveMisses: max,
                    keyword,
                });
                cleaned = cleanPages(rawPages, { keyword: '' });

                queueBackgroundStore(cleaned, 'researchFetch');
            }
            
            return cleaned.map(p => ({
                title: p.title,
                url: p.url,
                text: p.cleanedText, // Full extracted text
            }));
        } finally {
            await browser.close();
        }
    },

    /**
     * Lightweight web search for Ask mode:
     * seed search (few URLs) → crawl just those pages → clean → return text.
     * No chunking, embedding, or storage.
     */
    async quickSearch({ keyword, maxPages }) {
        const max = maxPages || 3;
        const browser = await chromium.launch({ headless: true });
        let cleaned = [];
        try {
            const seedUrls = await seedSearch(browser, {
                keyword,
                count: max,
                search: {
                    gotoTimeout: 10000,
                    selectorTimeout: 5000,
                    totalTimeout: 18000,
                },
            });
            if (seedUrls.length > 0) {
                const rawPages = await crawl(browser, seedUrls, {
                    concurrency: 2,
                    hardMaxPages: max,
                    maxConsecutiveMisses: max,
                    keyword,
                    navTimeout: 12000,
                });

                cleaned = cleanPages(rawPages, { keyword: '' });

                queueBackgroundStore(cleaned, 'quickSearch');
            }

            return cleaned.map(p => ({
                title: p.title,
                url: p.url,
                text: p.cleanedText,
            }));
        } finally {
            await browser.close();
        }
    },

    /**
     * Batched web search: accepts multiple queries, launches ONE browser,
     * seeds all queries, deduplicates URLs, crawls once, and returns.
     * Total pages are capped by maxTotalPages (shared across all queries).
     */
    async batchQuickSearch({ queries, maxTotalPages }) {
        const totalCap = maxTotalPages || 5;
        const perQuery = Math.max(2, Math.ceil(totalCap / queries.length));
        const browser = await chromium.launch({ headless: true });
        try {
            // Seed all queries in parallel, dedupe URLs
            const seedSets = await Promise.all(
                queries.map(q => seedSearch(browser, {
                    keyword: q,
                    count: perQuery,
                    search: {
                        gotoTimeout: 9000,
                        selectorTimeout: 4500,
                        totalTimeout: 14000,
                    },
                }).catch(() => []))
            );
            const seen = new Set();
            const allSeeds = seedSets.flat().filter(url => {
                if (seen.has(url)) return false;
                seen.add(url);
                return true;
            }).slice(0, totalCap);

            console.log(`[BatchSearch] ${queries.length} queries → ${allSeeds.length} unique seed URLs (cap ${totalCap})`);
            if (allSeeds.length === 0) return [];

            const rawPages = await crawl(browser, allSeeds, {
                concurrency: 2,
                hardMaxPages: totalCap,
                maxConsecutiveMisses: totalCap,
                keyword: queries[0],
                navTimeout: 12000,
            });

            const cleaned = cleanPages(rawPages, { keyword: '' });

            queueBackgroundStore(cleaned, 'batchQuickSearch');

            return cleaned.map(p => ({
                title: p.title,
                url: p.url,
                text: p.cleanedText,
            }));
        } finally {
            await browser.close();
        }
    },

    /**
     * Fetch a single URL – used when the model wants to read a specific source.
     * Crawls the page, cleans it, and returns the text.
     * Also stores it in the background for long-term memory.
     */
    async fetchUrl({ url }) {
        const browser = await chromium.launch({ headless: true });
        try {
            const rawPages = await crawl(browser, [url], {
                concurrency: 1,
                hardMaxPages: 1,
                maxConsecutiveMisses: 1,
                keyword: '',
            });

            if (rawPages.length === 0) return null;

            const cleaned = cleanPages(rawPages, { keyword: '' });
            if (cleaned.length === 0) return null;

            queueBackgroundStore(cleaned, 'fetchUrl');

            return {
                title: cleaned[0].title,
                url: cleaned[0].url,
                text: cleaned[0].cleanedText,
            };
        } finally {
            await browser.close();
        }
    },

    // Index selected web results into long-term RAG stores at low priority.
    async promoteSearchResults({ results }) {
        const cleaned = toPromotedCleanedPages(results);
        if (cleaned.length === 0) {
            return { promoted: 0, stored: { chroma: 0, sqlite: { pages: 0, chunks: 0 } } };
        }

        const chunked = chunkPages(cleaned, {});
        await embed(chunked);
        const stored = await store(chunked);
        return { promoted: cleaned.length, stored };
    },
};

// ── Message loop ──────────────────────────────────────────

parentPort.on('message', async ({ taskId, type, data }) => {
    try {
        const handler = handlers[type];
        if (!handler) throw new Error(`Unknown ingestion task type: ${type}`);
        const result = await handler(data ?? {});
        parentPort.postMessage({ taskId, result });
    } catch (err) {
        parentPort.postMessage({ taskId, error: err.message });
    }
});
