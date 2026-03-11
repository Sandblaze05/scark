/**
 * Embed Service - local inference via @xenova/transformers
 *
 * Replaces the Ollama /api/embed endpoint.
 * The model is downloaded once and cached to disk (no external service needed).
 * Works identically in Node.js worker threads and in the browser renderer.
 */

import { pipeline } from '@xenova/transformers';
import fs from 'fs';

// Xenova/nomic-embed-text-v1 produces 768-dim vectors, same as Ollama nomic-embed-text.
const MODEL = process.env.EMBED_MODEL || 'Xenova/nomic-embed-text-v1';
const MAX_EMBED_WORDS = 2000;
const BATCH_SIZE = parseInt(process.env.SCARK_EMBED_BATCH, 10) || 16;

/** Truncate text to stay within the model context window. */
function truncateForEmbed(text) {
    const words = text.split(/\s+/);
    if (words.length <= MAX_EMBED_WORDS) return text;
    return words.slice(0, MAX_EMBED_WORDS).join(' ');
}

// Singleton pipeline instance, lazy-loaded once per process/worker.
let _embedder = null;
let _loadPromise = null;

async function getEmbedder() {
    if (_embedder) return _embedder;
    if (_loadPromise) return _loadPromise;
    _loadPromise = pipeline('feature-extraction', MODEL).then(e => {
        _embedder = e;
        _loadPromise = null;
        console.log(`[EmbedService] Model "${MODEL}" ready.`);
        return e;
    });
    return _loadPromise;
}

/**
 * Generate an embedding for a single text.
 *
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedText(text) {
    const embedder = await getEmbedder();
    const out = await embedder(truncateForEmbed(text), { pooling: 'mean', normalize: true });
    return Array.from(out.data);
}

/**
 * Generate embeddings for an array of texts (serial batching to keep memory stable).
 *
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
    const embedder = await getEmbedder();
    const results = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE).map(truncateForEmbed);
        for (const text of batch) {
            const out = await embedder(text, { pooling: 'mean', normalize: true });
            results.push(Array.from(out.data));
        }
    }
    return results;
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Embed all chunks from crawl results in-place.
 * Adds an `embedding` field to each chunk object.
 *
 * @param {Array} results - array of { title, url, chunks: [{ text, ... }] }
 * @returns {Promise<Array>}
 */
export async function embedChunks(results) {
    let total = 0;
    for (const result of results) {
        const texts = result.chunks.map(c => c.text);
        if (texts.length === 0) continue;
        console.log(`Embedding ${texts.length} chunk(s) from: ${result.title}`);
        const vectors = await embedBatch(texts);
        for (let i = 0; i < result.chunks.length; i++) {
            result.chunks[i].embedding = vectors[i];
        }
        total += texts.length;
    }
    console.log(`Embedded ${total} chunks total.`);
    return results;
}

const DEFAULT_FILE = 'results.json';

/**
 * Load stored results (with embedded chunks) from disk.
 */
export function loadEmbeddings(file = DEFAULT_FILE) {
    if (!fs.existsSync(file)) return [];
    const results = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return results.flatMap(r =>
        r.chunks
            .filter(c => c.embedding)
            .map(c => ({
                text: c.text,
                embedding: c.embedding,
                metadata: { title: r.title, url: r.url, chunk_index: c.chunk_index, word_count: c.word_count },
            }))
    );
}

/**
 * Semantic search: embed a query and return top-k most similar chunks.
 */
export async function search(query, topK = 5, file = DEFAULT_FILE) {
    const records = loadEmbeddings(file);
    if (records.length === 0) return [];
    const queryVec = await embedText(query);
    const scored = records.map(r => ({ ...r, score: cosineSimilarity(queryVec, r.embedding) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ embedding, ...rest }) => rest);
}