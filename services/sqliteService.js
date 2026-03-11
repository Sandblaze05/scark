import Database from 'better-sqlite3';
import path from 'path';
import { randomUUID } from 'crypto';

const DB_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), 'scark.db');

let _db = null;
const MAX_CHAT_MESSAGES = 24;
const MAX_CHAT_CHAR_BUDGET = 12000;

function nowIso() {
    return new Date().toISOString();
}

/**
 * Lazily open (or create) the SQLite database and ensure the schema exists.
 *
 * Schema
 * ──────
 * pages  – one row per crawled page (metadata + full cleaned text)
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
            timestamp       TEXT,
            cleaned_text    TEXT
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

        CREATE TABLE IF NOT EXISTS chat_sessions (
            id              TEXT    PRIMARY KEY,
            title           TEXT    NOT NULL,
            summary         TEXT    DEFAULT '',
            is_pinned       INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT    NOT NULL,
            updated_at      TEXT    NOT NULL,
            last_active_at  TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id           TEXT    NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
            role              TEXT    NOT NULL,
            content           TEXT    NOT NULL,
            reasoning_preview TEXT,
            created_at        TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_active ON chat_sessions(last_active_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_sessions_pinned ON chat_sessions(is_pinned DESC, last_active_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id, id);
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
            (url, title, domain, word_count, chunk_count, keyword_density, timestamp, cleaned_text)
        VALUES
            (@url, @title, @domain, @word_count, @chunk_count, @keyword_density, @timestamp, @cleaned_text)
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
                cleaned_text:    result.cleanedText ?? null,
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

/**
 * Retrieve the full cleaned text for a page, given any chunk id or URL.
 *
 * @param {string} idOrUrl – a ChromaDB chunk id ("<url>::<chunk_index>") or a page URL
 * @returns {{ url: string, title: string, cleaned_text: string } | undefined}
 */
export function getPageText(idOrUrl) {
    const url = idOrUrl.includes('::') ? idOrUrl.split('::')[0] : idOrUrl;
    return getDb()
        .prepare('SELECT url, title, cleaned_text FROM pages WHERE url = ?')
        .get(url);
}

function ensureChatExists(chatId) {
    const row = getDb().prepare('SELECT id FROM chat_sessions WHERE id = ?').get(chatId);
    if (!row) throw new Error(`Chat not found: ${chatId}`);
}

function enforceChatBudget(chatId) {
    const db = getDb();

    const countRow = db.prepare('SELECT COUNT(*) AS total FROM chat_messages WHERE chat_id = ?').get(chatId);
    const total = countRow?.total ?? 0;
    if (total > MAX_CHAT_MESSAGES) {
        const over = total - MAX_CHAT_MESSAGES;
        const oldRows = db.prepare('SELECT id FROM chat_messages WHERE chat_id = ? ORDER BY id ASC LIMIT ?').all(chatId, over);
        const del = db.prepare('DELETE FROM chat_messages WHERE id = ?');
        for (const row of oldRows) del.run(row.id);
    }

    const rows = db.prepare('SELECT id, content FROM chat_messages WHERE chat_id = ? ORDER BY id ASC').all(chatId);
    let charTotal = rows.reduce((sum, r) => sum + (r.content?.length ?? 0), 0);
    if (charTotal <= MAX_CHAT_CHAR_BUDGET) return;

    const del = db.prepare('DELETE FROM chat_messages WHERE id = ?');
    for (const row of rows) {
        if (charTotal <= MAX_CHAT_CHAR_BUDGET) break;
        del.run(row.id);
        charTotal -= row.content?.length ?? 0;
    }
}

export function listChatSessions() {
    const db = getDb();
    return db.prepare(`
        SELECT
            s.id,
            s.title,
            s.summary,
            s.is_pinned AS isPinned,
            s.created_at AS createdAt,
            s.updated_at AS updatedAt,
            s.last_active_at AS lastActiveAt,
            (
                SELECT m.content
                FROM chat_messages m
                WHERE m.chat_id = s.id
                ORDER BY m.id DESC
                LIMIT 1
            ) AS lastMessage
        FROM chat_sessions s
        ORDER BY s.is_pinned DESC, s.last_active_at DESC
    `).all();
}

export function createChatSession({ title = 'New chat', isPinned = false } = {}) {
    const db = getDb();
    const id = randomUUID();
    const ts = nowIso();

    db.prepare(`
        INSERT INTO chat_sessions (id, title, summary, is_pinned, created_at, updated_at, last_active_at)
        VALUES (?, ?, '', ?, ?, ?, ?)
    `).run(id, title, isPinned ? 1 : 0, ts, ts, ts);

    return db.prepare(`
        SELECT id, title, summary, is_pinned AS isPinned, created_at AS createdAt, updated_at AS updatedAt, last_active_at AS lastActiveAt
        FROM chat_sessions WHERE id = ?
    `).get(id);
}

export function getChatSession(chatId) {
    const db = getDb();
    const chat = db.prepare(`
        SELECT id, title, summary, is_pinned AS isPinned, created_at AS createdAt, updated_at AS updatedAt, last_active_at AS lastActiveAt
        FROM chat_sessions WHERE id = ?
    `).get(chatId);
    if (!chat) return null;

    const messages = db.prepare(`
        SELECT id, chat_id AS chatId, role, content, reasoning_preview AS reasoningPreview, created_at AS createdAt
        FROM chat_messages
        WHERE chat_id = ?
        ORDER BY id ASC
    `).all(chatId);

    return { ...chat, messages };
}

export function renameChatSession(chatId, title) {
    ensureChatExists(chatId);
    const db = getDb();
    const ts = nowIso();
    db.prepare('UPDATE chat_sessions SET title = ?, updated_at = ?, last_active_at = ? WHERE id = ?')
        .run(title, ts, ts, chatId);
    return getChatSession(chatId);
}

export function setChatPinned(chatId, isPinned) {
    ensureChatExists(chatId);
    const db = getDb();
    const ts = nowIso();
    db.prepare('UPDATE chat_sessions SET is_pinned = ?, updated_at = ?, last_active_at = ? WHERE id = ?')
        .run(isPinned ? 1 : 0, ts, ts, chatId);
    return getChatSession(chatId);
}

export function deleteChatSession(chatId) {
    ensureChatExists(chatId);
    const db = getDb();
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(chatId);
    return { success: true };
}

export function setChatSummary(chatId, summary) {
    ensureChatExists(chatId);
    const db = getDb();
    const ts = nowIso();
    db.prepare('UPDATE chat_sessions SET summary = ?, updated_at = ?, last_active_at = ? WHERE id = ?')
        .run(summary ?? '', ts, ts, chatId);
    return getChatSession(chatId);
}

export function addChatMessage({ chatId, role, content, reasoningPreview = '' }) {
    ensureChatExists(chatId);
    const db = getDb();
    const ts = nowIso();

    const insert = db.prepare(`
        INSERT INTO chat_messages (chat_id, role, content, reasoning_preview, created_at)
        VALUES (?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
        insert.run(chatId, role, content, reasoningPreview, ts);
        db.prepare('UPDATE chat_sessions SET updated_at = ?, last_active_at = ? WHERE id = ?').run(ts, ts, chatId);
        enforceChatBudget(chatId);
    });
    tx();

    return getChatSession(chatId);
}

export function touchChatSession(chatId) {
    ensureChatExists(chatId);
    const ts = nowIso();
    getDb().prepare('UPDATE chat_sessions SET last_active_at = ? WHERE id = ?').run(ts, chatId);
    return { success: true };
}
