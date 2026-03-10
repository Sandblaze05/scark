/**
 * Pipeline Stage 2 – Crawler (parallel workers)
 *
 * Spawns N browser tabs that pull URLs from a shared queue, fetch each page,
 * and return raw page objects.  Link discovery feeds the queue so the crawl
 * expands breadth-first.
 *
 * Stop condition: **topic saturation** rather than a fixed page count.
 * The crawler tracks three metrics over a sliding window of recent pages:
 *
 *   1. Keyword relevance rate – fraction of recent pages containing the topic keyword
 *   2. Content novelty        – ratio of never-seen-before word trigrams
 *   3. Consecutive misses     – streak of pages with zero keyword hits
 *
 * When relevance AND novelty both drop below their thresholds (or the
 * miss streak exceeds its limit), the crawl stops.  A hard cap prevents
 * runaway crawls.
 *
 * Data contract
 * ─────────────
 *   Input :  browser, seedUrls[], opts
 *   Output:  RawPage[] — { url, title, html, bodyText, links[] }
 */

import { crawler as defaults } from './config.js';

// ── Saturation tracker ────────────────────────────────────

class SaturationTracker {
    #keyword;
    #keywordTokens;
    #window;          // sliding-window size
    #minRelevance;
    #minNovelty;
    #maxMisses;
    #hardMax;

    #relevanceRing;   // circular buffer: 1 = relevant, 0 = not
    #ringIdx = 0;
    #seenShingles = new Set();
    #consecutiveMisses = 0;
    #totalPages = 0;

    constructor(opts = {}) {
        this.#keyword       = (opts.keyword ?? '').toLowerCase();
        this.#window        = opts.saturationWindow     ?? 10;
        this.#minRelevance  = opts.minRelevance          ?? 0.3;
        this.#minNovelty    = opts.minNovelty             ?? 0.15;
        this.#maxMisses     = opts.maxConsecutiveMisses   ?? 5;
        this.#hardMax       = opts.hardMaxPages           ?? 100;
        this.#relevanceRing = new Array(this.#window).fill(-1); // -1 = unfilled

        // Pre-split keyword into tokens for individual word matching
        this.#keywordTokens = this.#keyword
            .split(/\s+/)
            .filter(w => w.length >= 2);
    }

    /** Check if text contains at least half of the keyword tokens */
    #matchesKeyword(text) {
        if (this.#keywordTokens.length === 0) return true;
        const lower = text.toLowerCase();
        const hits = this.#keywordTokens.filter(t => lower.includes(t)).length;
        return hits >= Math.ceil(this.#keywordTokens.length / 2);
    }

    /** Generate word-trigram shingles from text */
    #shingles(text) {
        const words = text.toLowerCase().split(/\s+/).filter(Boolean);
        const out = new Set();
        for (let i = 0; i <= words.length - 3; i++) {
            out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
        }
        return out;
    }

    /**
     * Feed a page's body text and return whether crawling should continue.
     * @returns {{ shouldContinue: boolean, reason?: string, metrics: object }}
     */
    record(bodyText) {
        this.#totalPages++;

        // ── Keyword relevance ─────────────────────────────
        const hasKeyword = this.#keyword
            ? this.#matchesKeyword(bodyText)
            : true;  // no keyword → every page counts as relevant

        this.#relevanceRing[this.#ringIdx % this.#window] = hasKeyword ? 1 : 0;
        this.#ringIdx++;

        if (hasKeyword) {
            this.#consecutiveMisses = 0;
        } else {
            this.#consecutiveMisses++;
        }

        // ── Content novelty ───────────────────────────────
        const pageShingles = this.#shingles(bodyText);
        let newCount = 0;
        for (const s of pageShingles) {
            if (!this.#seenShingles.has(s)) {
                newCount++;
                this.#seenShingles.add(s);
            }
        }
        const novelty = pageShingles.size > 0 ? newCount / pageShingles.size : 0;

        // ── Sliding-window relevance rate ─────────────────
        const filled = this.#relevanceRing.filter(v => v !== -1);
        const relevanceRate = filled.length > 0
            ? filled.reduce((a, b) => a + b, 0) / filled.length
            : 1;

        const metrics = {
            totalPages: this.#totalPages,
            relevanceRate: +relevanceRate.toFixed(3),
            novelty: +novelty.toFixed(3),
            consecutiveMisses: this.#consecutiveMisses,
        };

        // ── Stop conditions ───────────────────────────────
        if (this.#totalPages >= this.#hardMax) {
            return { shouldContinue: false, reason: 'hard page cap reached', metrics };
        }
        if (this.#consecutiveMisses >= this.#maxMisses) {
            return { shouldContinue: false, reason: `${this.#maxMisses} consecutive misses`, metrics };
        }
        // Only evaluate sliding-window thresholds once the window is full
        if (filled.length >= this.#window) {
            if (relevanceRate < this.#minRelevance && novelty < this.#minNovelty) {
                return { shouldContinue: false, reason: 'topic saturated (low relevance + low novelty)', metrics };
            }
        }

        return { shouldContinue: true, metrics };
    }
}

// ── Crawler ───────────────────────────────────────────────

/**
 * Crawl starting from `seedUrls` using parallel browser workers.
 * Stops automatically when the topic is saturated.
 *
 * @param {import('playwright-core').Browser} browser
 * @param {string[]} seedUrls
 * @param {object}   [opts]
 * @param {number}   [opts.concurrency]
 * @param {boolean}  [opts.sameDomain]
 * @param {number}   [opts.navTimeout]
 * @param {string}   [opts.keyword]
 * @param {number}   [opts.saturationWindow]
 * @param {number}   [opts.minRelevance]
 * @param {number}   [opts.minNovelty]
 * @param {number}   [opts.maxConsecutiveMisses]
 * @param {number}   [opts.hardMaxPages]
 * @param {Set<string>} [opts.skipUrls]
 * @returns {Promise<Array>}  array of RawPage objects
 */
export async function crawl(browser, seedUrls, opts = {}) {
    const concurrency = opts.concurrency ?? defaults.concurrency;
    const sameDomain  = opts.sameDomain  ?? defaults.sameDomain;
    const navTimeout  = opts.navTimeout  ?? defaults.navTimeout;
    const skipUrls    = opts.skipUrls    ?? new Set();

    const tracker = new SaturationTracker({
        keyword:              opts.keyword              ?? defaults.keyword,
        saturationWindow:     opts.saturationWindow     ?? defaults.saturationWindow,
        minRelevance:         opts.minRelevance          ?? defaults.minRelevance,
        minNovelty:           opts.minNovelty             ?? defaults.minNovelty,
        maxConsecutiveMisses: opts.maxConsecutiveMisses   ?? defaults.maxConsecutiveMisses,
        hardMaxPages:         opts.hardMaxPages           ?? defaults.hardMaxPages,
    });

    const visited  = new Set(skipUrls);
    const inFlight = new Set();
    const queued   = new Set(seedUrls.map(u => u.split('#')[0]));
    const queue    = [...queued].filter(u => !visited.has(u));
    const rawPages = [];
    let   activeWorkers = 0;
    let   saturated = false;
    let   stopReason = '';

    const startDomain = seedUrls.length > 0
        ? new URL(seedUrls[0]).hostname
        : '';

    const worker = async (id) => {
        const page = await browser.newPage();
        activeWorkers++;

        while (!saturated) {
            const url = queue.shift();

            if (!url) {
                if (activeWorkers <= 1) break;
                await new Promise(r => setTimeout(r, 150));
                continue;
            }

            queued.delete(url);
            if (visited.has(url) || inFlight.has(url)) continue;
            if (saturated) break;

            inFlight.add(url);
            visited.add(url);

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
                inFlight.delete(url);

                const html     = await page.content();
                const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
                const title    = await page.title();

                const links = await page.$$eval('a[href]', anchors =>
                    anchors.map(a => a.href).filter(href => href.startsWith('http'))
                );

                rawPages.push({ url, title, html, bodyText, links });

                // ── Saturation check (shared across all workers) ──
                const { shouldContinue, reason, metrics } = tracker.record(bodyText);
                console.log(
                    `[Crawler W${id}] [${metrics.totalPages}] ${url}` +
                    `  rel=${metrics.relevanceRate} nov=${metrics.novelty} miss=${metrics.consecutiveMisses}`
                );
                if (!shouldContinue) {
                    saturated = true;
                    stopReason = reason;
                    break;
                }

                // Enqueue discovered links
                for (const link of links) {
                    try {
                        const cleanLink  = link.split('#')[0];
                        const linkDomain = new URL(cleanLink).hostname;
                        if (
                            !visited.has(cleanLink) &&
                            !inFlight.has(cleanLink) &&
                            !queued.has(cleanLink) &&
                            (!sameDomain || linkDomain === startDomain)
                        ) {
                            queue.push(cleanLink);
                            queued.add(cleanLink);
                        }
                    } catch { /* ignore invalid URLs */ }
                }
            } catch (err) {
                inFlight.delete(url);
                console.log(`[Crawler W${id}]   Failed: ${err.message}`);
            }
        }

        activeWorkers--;
        await page.close();
    };

    const workers = Array.from(
        { length: Math.min(concurrency, Math.max(seedUrls.length, 1)) },
        (_, i) => worker(i + 1),
    );
    await Promise.all(workers);

    console.log(`[Crawler] Done – visited ${visited.size} page(s), captured ${rawPages.length} raw page(s).`);
    if (stopReason) console.log(`[Crawler] Stop reason: ${stopReason}`);
    return rawPages;
}
