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
 *   embed        – generate embeddings for chunks (via Ollama)
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
     * Lightweight web search for Ask mode:
     * seed search (few URLs) → crawl just those pages → clean → return text.
     * No chunking, embedding, or storage.
     */
    async quickSearch({ keyword, maxPages }) {
        const max = maxPages || 3;
        const browser = await chromium.launch({ headless: true });
        try {
            const seedUrls = await seedSearch(browser, { keyword, count: max });
            if (seedUrls.length === 0) return [];

            const rawPages = await crawl(browser, seedUrls, {
                concurrency: 2,
                hardMaxPages: max,
                maxConsecutiveMisses: max,
                keyword,
            });

            const cleaned = cleanPages(rawPages, { keyword: '' });

            return cleaned.map(p => ({
                title: p.title,
                url: p.url,
                text: p.cleanedText.slice(0, 3000),
            }));
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
