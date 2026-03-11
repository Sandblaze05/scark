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
                
                // Fire and forget: store this in the background for long term memory
                setTimeout(async () => {
                    try {
                        const chunked = chunkPages(cleaned, {});
                        await embed(chunked);
                        await store(chunked);
                        console.log(`[Background] Stored ${chunked.length} pages to Vector DB for long term storage.`);
                    } catch (e) {
                        console.error('[Background] Error storing deep research data:', e);
                    }
                }, 0);
            }
            
            return cleaned.map(p => ({
                title: p.title,
                url: p.url,
                text: p.cleanedText.slice(0, 5000), // Larger chunk for deep research directly
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
            const seedUrls = await seedSearch(browser, { keyword, count: max });
            if (seedUrls.length > 0) {
                const rawPages = await crawl(browser, seedUrls, {
                    concurrency: 2,
                    hardMaxPages: max,
                    maxConsecutiveMisses: max,
                    keyword,
                });

                cleaned = cleanPages(rawPages, { keyword: '' });

                // Background store for long term memory
                setTimeout(async () => {
                    try {
                        const chunked = chunkPages(cleaned, {});
                        await embed(chunked);
                        await store(chunked);
                        console.log(`[Background] Stored ${chunked.length} quickSearch pages to Vector DB.`);
                    } catch (e) {
                        console.error('[Background] Error storing quickSearch data:', e);
                    }
                }, 0);
            }

            return cleaned.map(p => ({
                title: p.title,
                url: p.url,
                text: p.cleanedText.slice(0, 3000),
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
                queries.map(q => seedSearch(browser, { keyword: q, count: perQuery }).catch(() => []))
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
            });

            const cleaned = cleanPages(rawPages, { keyword: '' });

            // Background store
            setTimeout(async () => {
                try {
                    const chunked = chunkPages(cleaned, {});
                    await embed(chunked);
                    await store(chunked);
                    console.log(`[Background] Stored ${chunked.length} batchSearch pages to Vector DB.`);
                } catch (e) {
                    console.error('[Background] Error storing batchSearch data:', e);
                }
            }, 0);

            return cleaned.map(p => ({
                title: p.title,
                url: p.url,
                text: p.cleanedText.slice(0, 3000),
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

            // Background store for long-term memory
            setTimeout(async () => {
                try {
                    const chunked = chunkPages(cleaned, {});
                    await embed(chunked);
                    await store(chunked);
                    console.log(`[Background] Stored fetched URL to Vector DB: ${url}`);
                } catch (e) {
                    console.error('[Background] Error storing fetched URL:', e);
                }
            }, 0);

            return {
                title: cleaned[0].title,
                url: cleaned[0].url,
                text: cleaned[0].cleanedText.slice(0, 5000),
            };
        } finally {
            await browser.close();
        }
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
