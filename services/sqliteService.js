import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), 'scark.db');

let _db = null;

/**
 * Lazily open (or create) the SQLite database and ensure the schema exists.
 *
 * Schema
 * ──────
 * pages  – one row per crawled page (metadata only, no raw text / vectors)
 * chunks – one row per chunk; stores text + position reference but NOT the
 *          embedding (that lives in ChromaDB).  The id column mirrors the
 *          ChromaDB document id: "<url>::<chunk_index>"
 */
function getDb() {
    if (_db) return _db;

    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');   // better write concurrency
    _db.pragma('foreign_keys = ON');

    _db.exec(`
        CREATE TABLE IF NOT EXISTS pages (
            url             TEXT    PRIMARY KEY,
            title           TEXT,
            domain          TEXT,
            word_count      INTEGER,
            chunk_count     INTEGER,
            keyword_density REAL,
            timestamp       TEXT
        );

        CREATE TABLE IF NOT EXISTS chunks (
            id          TEXT    PRIMARY KEY,   -- "<url>::<chunk_index>"
            url         TEXT    NOT NULL REFERENCES pages(url),
            chunk_index INTEGER NOT NULL,
            word_count  INTEGER,
            text        TEXT,
            timestamp   TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_url ON chunks(url);
    `);

    console.log(`[SQLite] Database ready at ${DB_PATH}`);
    return _db;
}

/**
 * Insert (or replace) all pages and their chunk references into SQLite.
 * Everything runs inside a single transaction for atomicity and speed.
 *
 * NOTE: embeddings are intentionally NOT stored here – they belong in
 *       ChromaDB where they can be efficiently queried by similarity.
 *
 * @param {Array} results – crawl results array (same shape as results.json)
 * @returns {{ pages: number, chunks: number }}
 */
export function storeInSQLite(results) {
    const db = getDb();

    const upsertPage = db.prepare(`
        INSERT OR REPLACE INTO pages
            (url, title, domain, word_count, chunk_count, keyword_density, timestamp)
        VALUES
            (@url, @title, @domain, @word_count, @chunk_count, @keyword_density, @timestamp)
    `);

    const upsertChunk = db.prepare(`
        INSERT OR REPLACE INTO chunks
            (id, url, chunk_index, word_count, text, timestamp)
        VALUES
            (@id, @url, @chunk_index, @word_count, @text, @timestamp)
    `);

    let chunkCount = 0;

    const insertAll = db.transaction((results) => {
        for (const result of results) {
            upsertPage.run({
                url:             result.url,
                title:           result.title,
                domain:          result.metadata.domain,
                word_count:      result.metadata.word_count,
                chunk_count:     result.metadata.chunk_count,
                keyword_density: result.metadata.keyword_density,
                timestamp:       result.metadata.timestamp,
            });

            for (const chunk of result.chunks) {
                upsertChunk.run({
                    id:          `${result.url}::${chunk.chunk_index}`,
                    url:         result.url,
                    chunk_index: chunk.chunk_index,
                    word_count:  chunk.word_count,
                    text:        chunk.text,
                    timestamp:   result.metadata.timestamp,
                });
                chunkCount++;
            }
        }
    });

    insertAll(results);

    console.log(
        `[SQLite] Stored ${results.length} pages and ${chunkCount} chunk references.`
    );
    return { pages: results.length, chunks: chunkCount };
}

/**
 * Retrieve the full chunk record for a given ChromaDB-style id.
 *
 * @param {string} id  – "<url>::<chunk_index>"
 * @returns {object|undefined}
 */
export function getChunkById(id) {
    return getDb().prepare('SELECT * FROM chunks WHERE id = ?').get(id);
}

/**
 * Retrieve all chunk records for a page URL.
 *
 * @param {string} url
 * @returns {object[]}
 */
export function getChunksByUrl(url) {
    return getDb()
        .prepare('SELECT * FROM chunks WHERE url = ? ORDER BY chunk_index')
        .all(url);
}

/**
 * Return a Set of all page URLs already stored in the database.
 * Used at startup to skip re-crawling / re-embedding pages we already have.
 *
 * @returns {Set<string>}
 */
export function getExistingUrls() {
    const rows = getDb().prepare('SELECT url FROM pages').all();
    return new Set(rows.map(r => r.url));
}
