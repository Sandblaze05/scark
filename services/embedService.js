const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const BATCH_SIZE = 32; // max texts per Ollama request
const MAX_EMBED_WORDS = 2000; // safe limit for nomic-embed-text context window

import fs from 'fs';

/** Truncate text to MAX_EMBED_WORDS to avoid exceeding model context length. */
function truncateForEmbed(text) {
    const words = text.split(/\s+/);
    if (words.length <= MAX_EMBED_WORDS) return text;
    return words.slice(0, MAX_EMBED_WORDS).join(' ');
}

/**
 * Generate an embedding for a single text via Ollama.
 */
export async function embedText(text) {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, input: truncateForEmbed(text) }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Ollama embed failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    return data.embeddings[0];
}

/**
 * Generate embeddings for an array of texts, batching requests.
 */
async function embedBatch(texts) {
    const embeddings = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE).map(truncateForEmbed);
        const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: EMBED_MODEL, input: batch }),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Ollama embed failed (${res.status}): ${body}`);
        }
        const data = await res.json();
        embeddings.push(...data.embeddings);
    }
    return embeddings;
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
 * Adds an `embedding` field to each chunk object in the results array.
 *
 * Output format per result:
 * {
 *   "title": "...",
 *   "url": "...",
 *   "chunks": [
 *     { "chunk_index": 0, "text": "...", "embedding": [0.021, ...], "word_count": 480 }
 *   ]
 * }
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
    // Flatten chunks for search
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
 * Semantic search: embed a query and return the top-k most similar chunks.
 */
export async function search(query, topK = 5, file = DEFAULT_FILE) {
    const records = loadEmbeddings(file);
    if (records.length === 0) return [];

    const queryVec = await embedText(query);

    const scored = records.map(r => ({
        ...r,
        score: cosineSimilarity(queryVec, r.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ embedding, ...rest }) => rest);
}
