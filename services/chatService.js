/**
 * Chat Service - context retrieval helpers (LLM-free)
 *
 * All LLM inference has moved to the renderer via WebLLM (WebGPU).
 * This module provides only heuristic helpers and the system-prompt
 * builder used by the Electron main process during RAG context retrieval.
 */

/**
 * Return the last user message as a standalone search query.
 * Advanced pronoun-resolution rewriting is handled in the renderer via WebLLM.
 *
 * @param {Array<{ role: string, content: string }>} messages
 * @returns {string}
 */
export function rewriteQuery(messages) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    return lastUser?.content ?? '';
}

/**
 * Heuristic check: does this query need a search at all?
 * @param {string} query
 * @returns {boolean}
 */
export function requiresSearch(query) {
    const lower = query.toLowerCase().trim();
    const conversational = ['hi', 'hello', 'hey', 'greetings', 'sup', 'how are you', 'how are you?', "what's up"];
    return !conversational.includes(lower);
}

/**
 * Heuristic check: does this query need fresh / real-time data?
 * @param {string} query
 * @returns {boolean}
 */
export function requiresFreshData(query) {
    const lower = query.toLowerCase();
    return lower.includes('latest') || lower.includes('today') || lower.includes('recent')
        || lower.includes(' now') || lower.includes('news') || lower.includes('current');
}

/**
 * Build a system prompt that includes retrieved context chunks.
 *
 * @param {Array<{ title: string, url: string, text: string }>} contextChunks
 * @returns {string}
 */
export function buildSystemPrompt(contextChunks) {
    if (!contextChunks || contextChunks.length === 0) {
        return "You are a helpful assistant. Please double-check your facts internally and reason step-by-step before phrasing your single, final answer. Answer the user's question to the best of your ability.";
    }

    // Budget-trim context: ~4 chars/token, cap at 1800 tokens to leave room
    // for conversation history inside the 3200-token prompt budget.
    const CONTEXT_CHAR_BUDGET = 1800 * 4;
    let contextText = '';
    let usedChars = 0;
    for (let i = 0; i < contextChunks.length; i++) {
        const entry = `[${i + 1}] ${contextChunks[i].text}\n\n`;
        if (usedChars + entry.length > CONTEXT_CHAR_BUDGET && i > 0) break;
        contextText += entry;
        usedChars += entry.length;
    }

    return [
        "You are a highly analytical research assistant. Use the reference material below to answer the user's question.",
        'IMPORTANT: You must establish an ability to reason internally. Double-check your facts for accuracy based on the reference material before presenting your single, unified final response. Break down your logic step-by-step.',
        'Write a clear, concise final answer in your own words. Do NOT copy-paste the source text.',
        'Mention source numbers like [1] when you use information from them.',
        "If the sources don't cover the question, say so briefly.",
        '',
        'Reference material:',
        contextText,
    ].join('\n');
}