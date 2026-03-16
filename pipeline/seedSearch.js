/**
 * Pipeline Stage 1 – Seed Search
 *
 * Accepts a Playwright browser instance and returns an array of seed URLs
 * discovered via search engines (DuckDuckGo → Google → Bing).
 *
 * Data contract
 * ─────────────
 *   Input :  browser, keyword, count
 *   Output:  string[]   unique seed URLs
 *
 * The heavy lifting is delegated to services/searchServices.js so this
 * module is a thin adapter between the pipeline and the service layer.
 */

import { getSearchSeeds as _search } from '../services/searchServices.js';
import { seed as defaults } from './config.js';

/**
 * Discover seed URLs for a keyword by scraping search-engine results.
 *
 * @param {import('playwright-core').Browser} browser
 * @param {object} [opts]
 * @param {string} [opts.keyword]
 * @param {number} [opts.count]
 * @returns {Promise<string[]>}
 */
export async function seedSearch(browser, opts = {}) {
    const keyword = opts.keyword ?? defaults.keyword;
    const count   = opts.count   ?? defaults.count;
    const searchOpts = opts.search ?? {};

    console.log(`[SeedSearch] Searching for "${keyword}" (max ${count} seeds)…`);
    const urls = await _search(browser, keyword, count, searchOpts);

    if (urls.length === 0) {
        console.warn('[SeedSearch] No seed URLs found from any search engine.');
    } else {
        console.log(`[SeedSearch] ${urls.length} seed URL(s) collected.`);
    }

    return urls;
}
