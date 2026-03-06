import { ChromaClient } from 'chromadb';

const CHROMA_URL        = process.env.CHROMA_URL        || 'http://localhost:8000';
const COLLECTION_NAME   = process.env.CHROMA_COLLECTION || 'scark_chunks';
const UPSERT_BATCH_SIZE = 500; // max items per upsert call

let _client     = null;
let _collection = null;

/**
 * Lazily initialise the ChromaDB client and get/create the collection.
 * The collection uses cosine distance so it matches the in-memory cosine
 * similarity already used in embedService.js.
 */
async function getCollection() {
    if (_collection) return _collection;

    const url  = new URL(CHROMA_URL);
    _client = new ChromaClient({
        host: url.hostname,
        port: parseInt(url.port || (url.protocol === 'https:' ? '443' : '8000'), 10),
        ssl:  url.protocol === 'https:',
    });

    // Pass a no-op embeddingFunction so Chroma never tries to load
    // @chroma-core/default-embed - we always supply our own vectors from Ollama.
    const noopEmbedder = { generate: async (texts) => texts.map(() => []) };

    _collection = await _client.getOrCreateCollection({
        name:              COLLECTION_NAME,
        metadata:          { 'hnsw:space': 'cosine' },
        embeddingFunction: noopEmbedder,
    });

    console.log(`[ChromaDB] Connected - collection "${COLLECTION_NAME}" ready.`);
    return _collection;
}

/**
 * Upsert every embedded chunk from the crawl results into ChromaDB.
 *
 * Each vector document gets:
 *   id        → "<url>::<chunk_index>"  (stable, dedup-safe)
 *   embedding → float[] from Ollama
 *   document  → raw chunk text (for retrieval)
 *   metadata  → url, title, chunk_index, word_count, domain, timestamp
 *
 * Chunks without embeddings are silently skipped.
 */
export async function storeInChroma(results) {
    const col = await getCollection();

    const ids        = [];
    const embeddings = [];
    const documents  = [];
    const metadatas  = [];

    for (const result of results) {
        for (const chunk of result.chunks) {
            if (!chunk.embedding) continue;

            ids.push(`${result.url}::${chunk.chunk_index}`);
            embeddings.push(chunk.embedding);
            documents.push(chunk.text);
            metadatas.push({
                url:           result.url,
                title:         result.title,
                chunk_index:   chunk.chunk_index,
                word_count:    chunk.word_count,
                domain:        result.metadata.domain,
                keyword_density: result.metadata.keyword_density,
                timestamp:     result.metadata.timestamp,
            });
        }
    }

    if (ids.length === 0) {
        console.log('[ChromaDB] No embedded chunks to store - skipping.');
        return 0;
    }

    // Upsert in batches to stay under ChromaDB payload limits
    for (let i = 0; i < ids.length; i += UPSERT_BATCH_SIZE) {
        const end = Math.min(i + UPSERT_BATCH_SIZE, ids.length);
        await col.upsert({
            ids:        ids.slice(i, end),
            embeddings: embeddings.slice(i, end),
            documents:  documents.slice(i, end),
            metadatas:  metadatas.slice(i, end),
        });
    }

    console.log(`[ChromaDB] Upserted ${ids.length} chunks into "${COLLECTION_NAME}".`);
    return ids.length;
}

/**
 * Query the ChromaDB collection for the top-k nearest chunks to a query
 * embedding.  Returns ChromaDB's raw QueryResponse.
 *
 * @param {number[]} queryEmbedding  - pre-computed embedding vector
 * @param {number}   topK            - number of results (default 5)
 */
export async function queryChroma(queryEmbedding, topK = 5) {
    const col = await getCollection();
    return col.query({
        queryEmbeddings: [queryEmbedding],
        nResults:        topK,
        include:         ['documents', 'metadatas', 'distances'],
    });
}
