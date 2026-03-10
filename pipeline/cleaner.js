/**
 * Pipeline Stage 3 – Cleaner
 *
 * Takes raw HTML (or a page body string) and extracts readable article text
 * using Mozilla Readability.  Optionally filters pages by keyword presence.
 *
 * Data contract
 * ─────────────
 *   Input :  RawPage   { url, html, title? }
 *   Output:  CleanedPage { url, title, cleanedText, metadata }
 *            or null when the page doesn't match the keyword filter.
 */

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { cleaner as defaults } from './config.js';

/**
 * Extract article text from raw HTML.
 *
 * @param {string} html       – full page HTML
 * @param {string} url        – the page URL (Readability uses it for relative link resolution)
 * @param {string} [fallback] – fallback plain-text if Readability can't parse
 * @returns {{ title: string, text: string }}
 */
export function extractArticle(html, url, fallback = '') {
    const doc     = new JSDOM(html, { url });
    const reader  = new Readability(doc.window.document);
    const article = reader.parse();

    return {
        title: article?.title || '',
        text:  article?.textContent || fallback,
    };
}

/**
 * Clean raw text: collapse whitespace, trim.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalise(raw) {
    return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Split a keyword query into individual tokens for matching.
 * Filters out very short stopwords so "usa" is kept but "a" is not.
 */
function keywordTokens(keyword) {
    return keyword
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length >= 2);
}

/**
 * Check whether `text` contains enough of the keyword tokens.
 * Returns true when at least half of the individual keyword words appear.
 */
export function keywordMatch(text, keyword) {
    const tokens = keywordTokens(keyword);
    if (tokens.length === 0) return true;
    const lower = text.toLowerCase();
    const hits = tokens.filter(t => lower.includes(t)).length;
    return hits >= Math.ceil(tokens.length / 2);
}

/**
 * Count occurrences of each keyword token (case-insensitive) in `text`
 * and return aggregate density as a percentage of total words.
 *
 * @param {string} text
 * @param {string} keyword
 * @returns {{ count: number, density: number }}
 */
export function keywordStats(text, keyword) {
    const lower = text.toLowerCase();
    const tokens = keywordTokens(keyword);
    const words = text.split(/\s+/).filter(Boolean).length;

    let count = 0;
    for (const t of tokens) {
        let idx = 0;
        while ((idx = lower.indexOf(t, idx)) !== -1) {
            count++;
            idx += t.length;
        }
    }

    const density = words > 0
        ? parseFloat(((count / words) * 100).toFixed(4))
        : 0;

    return { count, density };
}

/**
 * Clean a single raw page.
 *
 * @param {{ url: string, html: string, title?: string, bodyText?: string }} rawPage
 * @param {object} [opts]
 * @param {string} [opts.keyword] – keyword filter (empty string = accept all)
 * @returns {object|null}  cleaned page object, or null if filtered out
 */
export function cleanPage(rawPage, opts = {}) {
    const keyword = opts.keyword ?? defaults.keyword;

    const { title, text } = extractArticle(rawPage.html, rawPage.url, rawPage.bodyText);
    const cleanedText = normalise(text);
    const wordCount   = cleanedText.split(/\s+/).filter(Boolean).length;
    const domain      = new URL(rawPage.url).hostname;

    // Keyword filter — check individual words, not exact phrase
    if (keyword && !keywordMatch(cleanedText, keyword)) {
        return null;
    }

    const kw = keyword ? keywordStats(cleanedText, keyword) : { count: 0, density: 0 };

    return {
        url:   rawPage.url,
        title: rawPage.title || title,
        cleanedText,
        metadata: {
            word_count:      wordCount,
            domain,
            keyword_density: kw.density,
            timestamp:       new Date().toISOString(),
        },
    };
}

/**
 * Batch-clean an array of raw pages.
 *
 * @param {Array} rawPages
 * @param {object} [opts]
 * @returns {Array} cleaned pages (pages that didn't match are dropped)
 */
export function cleanPages(rawPages, opts = {}) {
    const cleaned = [];
    for (const rp of rawPages) {
        const page = cleanPage(rp, opts);
        if (page) cleaned.push(page);
    }
    console.log(`[Cleaner] ${cleaned.length}/${rawPages.length} pages passed keyword filter.`);
    return cleaned;
}
