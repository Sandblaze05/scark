/**
 * Centralised configuration for every pipeline stage.
 * Workers import only the slice they need.
 *
 */

// ── Seed search ───────────────────────────────────────────
export const seed = {
    /** Default keyword to search for */
    keyword:   process.env.SCARK_KEYWORD   || 'Semantic segmentation of satellite images',
    /** Number of seed URLs to collect */
    count:     parseInt(process.env.SCARK_SEED_COUNT, 10) || 10,
};

// ── Crawler ───────────────────────────────────────────────
export const crawler = {
    /** Maximum total pages to visit across all workers */
    maxPages:    parseInt(process.env.SCARK_MAX_PAGES, 10) || 20,
    /** Number of parallel browser tabs */
    concurrency: parseInt(process.env.SCARK_CONCURRENCY, 10) || 5,
    /** Stay on the same domain as the first seed? */
    sameDomain:  process.env.SCARK_SAME_DOMAIN === 'true',
    /** Navigation timeout per page (ms) */
    navTimeout:  parseInt(process.env.SCARK_NAV_TIMEOUT, 10) || 15000,
};

// ── Cleaner ───────────────────────────────────────────────
export const cleaner = {
    /** Optional keyword – only keep pages whose text contains it.
     *  Set to empty string to accept every page.                */
    keyword: seed.keyword,
};

// ── Chunker ───────────────────────────────────────────────
export const chunker = {
    /** Target words per chunk */
    chunkSize:    parseInt(process.env.SCARK_CHUNK_SIZE, 10) || 500,
    /** Overlapping words between consecutive chunks */
    chunkOverlap: parseInt(process.env.SCARK_CHUNK_OVERLAP, 10) || 50,
};

// ── Embedder ──────────────────────────────────────────────
export const embedder = {
    /** Ollama base URL */
    ollamaUrl:  process.env.OLLAMA_URL    || 'http://localhost:11434',
    /** Embedding model name */
    model:      process.env.EMBED_MODEL   || 'nomic-embed-text',
    /** Max texts sent to Ollama in one request */
    batchSize:  parseInt(process.env.SCARK_EMBED_BATCH, 10) || 32,
};

// ── Storage ───────────────────────────────────────────────
export const store = {
    chromaUrl:        process.env.CHROMA_URL        || 'http://localhost:8000',
    chromaCollection: process.env.CHROMA_COLLECTION || 'scark_chunks',
    sqlitePath:       process.env.SQLITE_PATH,      // undefined → default in sqliteService
    upsertBatch:      parseInt(process.env.SCARK_UPSERT_BATCH, 10) || 500,
};

// ── Output ────────────────────────────────────────────────
export const output = {
    file: process.env.SCARK_OUTPUT || 'results.json',
};
