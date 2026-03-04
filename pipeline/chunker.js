/**
 * Pipeline Stage 4 – Chunker
 *
 * Splits cleaned text into overlapping chunks at sentence boundaries,
 * ready for embedding.
 *
 * Data contract
 * ─────────────
 *   Input :  CleanedPage { url, title, cleanedText, metadata }
 *   Output:  ChunkedPage { ...CleanedPage, chunks[] }
 *            where each chunk = { chunk_index, text, word_count }
 */

import { chunker as defaults } from './config.js';

/**
 * Split `text` into overlapping word-count-based chunks,
 * breaking at sentence boundaries when possible.
 *
 * @param {string} text
 * @param {number} [chunkSize]
 * @param {number} [overlap]
 * @returns {string[]}
 */
export function chunkText(text, chunkSize = defaults.chunkSize, overlap = defaults.chunkOverlap) {
    const sentences = text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [text];
    const chunks = [];
    let currentWords = [];

    for (const sentence of sentences) {
        const words = sentence.trim().split(/\s+/).filter(Boolean);
        if (currentWords.length + words.length > chunkSize && currentWords.length > 0) {
            chunks.push(currentWords.join(' '));
            // Keep the last `overlap` words for continuity
            const overlapWords = currentWords.slice(-overlap);
            currentWords = [...overlapWords, ...words];
        } else {
            currentWords.push(...words);
        }
    }
    if (currentWords.length > 0) {
        chunks.push(currentWords.join(' '));
    }
    return chunks;
}

/**
 * Chunk a single cleaned page.
 *
 * @param {object} cleanedPage – output of cleaner stage
 * @param {object} [opts]
 * @param {number} [opts.chunkSize]
 * @param {number} [opts.chunkOverlap]
 * @returns {object}  the page with a `chunks` array appended
 */
export function chunkPage(cleanedPage, opts = {}) {
    const size    = opts.chunkSize    ?? defaults.chunkSize;
    const overlap = opts.chunkOverlap ?? defaults.chunkOverlap;

    const texts = chunkText(cleanedPage.cleanedText, size, overlap);

    return {
        ...cleanedPage,
        chunks: texts.map((text, i) => ({
            chunk_index: i,
            text,
            word_count: text.split(/\s+/).filter(Boolean).length,
        })),
        metadata: {
            ...cleanedPage.metadata,
            chunk_count: texts.length,
        },
    };
}

/**
 * Batch-chunk an array of cleaned pages.
 *
 * @param {Array} cleanedPages
 * @param {object} [opts]
 * @returns {Array}
 */
export function chunkPages(cleanedPages, opts = {}) {
    const chunked = cleanedPages.map(p => chunkPage(p, opts));
    const totalChunks = chunked.reduce((sum, p) => sum + p.chunks.length, 0);
    console.log(`[Chunker] ${chunked.length} page(s) → ${totalChunks} chunk(s).`);
    return chunked;
}
