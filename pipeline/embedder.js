/**
 * Pipeline Stage 5 – Embedder (workers)
 *
 * Takes chunked pages and generates vector embeddings for every chunk via
 * the Ollama embedding service.
 *
 * Data contract
 * ─────────────
 *   Input :  ChunkedPage[]  (from chunker stage)
 *   Output:  EmbeddedPage[] — same shape, with `embedding` added to each chunk
 *
 * Delegates to services/embedService.js for the actual Ollama calls.
 */

import { embedChunks as _embedChunks } from '../services/embedService.js';

/**
 * Embed all chunks across an array of chunked pages.
 *
 * Mutates each chunk in-place (adds `embedding` field) and returns the
 * same array for chaining.
 *
 * @param {Array} chunkedPages – output from the chunker stage
 * @returns {Promise<Array>}
 */
export async function embed(chunkedPages) {
    if (chunkedPages.length === 0) {
        console.log('[Embedder] Nothing to embed.');
        return chunkedPages;
    }

    // Transform to the shape embedService expects:
    //   { title, url, chunks: [{ chunk_index, text, word_count }], metadata }
    // ChunkedPage already has this shape from the chunker stage.
    console.log(`[Embedder] Generating embeddings for ${chunkedPages.length} page(s)…`);
    await _embedChunks(chunkedPages);

    return chunkedPages;
}
