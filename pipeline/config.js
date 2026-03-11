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
    /** Number of parallel browser tabs */
    concurrency: parseInt(process.env.SCARK_CONCURRENCY, 10) || 5,
    /** Stay on the same domain as the first seed? */
    sameDomain:  process.env.SCARK_SAME_DOMAIN === 'true',
    /** Navigation timeout per page (ms) */
    navTimeout:  parseInt(process.env.SCARK_NAV_TIMEOUT, 10) || 15000,

    // ── Saturation settings ───────────────────────────────
    /** Topic keyword for relevance scoring (inherited from seed) */
    keyword:               seed.keyword,
    /** Sliding window size for saturation metrics */
    saturationWindow:      parseInt(process.env.SCARK_SAT_WINDOW, 10) || 10,
    /** Min fraction of recent pages that must contain the keyword (0–1) */
    minRelevance:          parseFloat(process.env.SCARK_MIN_RELEVANCE) || 0.3,
    /** Min ratio of new-content shingles per page (0–1) */
    minNovelty:            parseFloat(process.env.SCARK_MIN_NOVELTY) || 0.15,
    /** Stop after N consecutive pages with zero keyword hits */
    maxConsecutiveMisses:  parseInt(process.env.SCARK_MAX_MISSES, 10) || 5,
    /** Absolute safety cap – never crawl more than this */
    hardMaxPages:          parseInt(process.env.SCARK_HARD_MAX, 10) || 100,
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
    chunkSize:    parseInt(process.env.SCARK_CHUNK_SIZE, 10) || 200,
    /** Overlapping words between consecutive chunks */
    chunkOverlap: parseInt(process.env.SCARK_CHUNK_OVERLAP, 10) || 20,
};

// ── Embedder ──────────────────────────────────────────────
export const embedder = {
    /** HuggingFace model ID used by @xenova/transformers (local, no Ollama needed) */
    model:     process.env.EMBED_MODEL   || 'Xenova/nomic-embed-text-v1',
    /** Max texts per embedding batch */
    batchSize: parseInt(process.env.SCARK_EMBED_BATCH, 10) || 16,
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
