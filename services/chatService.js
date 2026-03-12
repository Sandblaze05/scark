/**
 * Chat Service - context retrieval helpers (LLM-free)
 *
 * All LLM inference has moved to the renderer via WebLLM (WebGPU).
 * This module provides only heuristic helpers and the system-prompt
 * builder used by the Electron main process during RAG context retrieval.
 */

/**
 * Return a self-contained search query derived from the conversation.
 *
 * If the last user message looks like a follow-up (short, contains pronouns
 * or words like "alternative", "other", "more", "else"), prepend the
 * previous user message so the search has topical context.
 *
 * @param {Array<{ role: string, content: string }>} messages
 * @returns {string}
 */
export function rewriteQuery(messages) {
    const userMsgs = messages.filter(m => m.role === 'user');
    const last = userMsgs[userMsgs.length - 1]?.content ?? '';
    if (!last) return '';

    // Heuristic: treat short messages with follow-up signals as context-dependent
    const isFollowUp = last.split(/\s+/).length <= 8 &&
        /\b(it|its|this|that|those|these|they|them|other|alternative|more|else|another|similar|instead|too|also|what about)\b/i.test(last);

    if (isFollowUp && userMsgs.length >= 2) {
        const prev = userMsgs[userMsgs.length - 2].content;
        // Take the first 120 chars of the previous question as topical anchor
        return `${prev.slice(0, 120)} — ${last}`;
    }

    return last;
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
        const ts = contextChunks[i].timestamp ? ` (Date: ${contextChunks[i].timestamp})` : '';
        const entry = `[${i + 1}]${ts} ${contextChunks[i].text}\n\n`;
        if (usedChars + entry.length > CONTEXT_CHAR_BUDGET && i > 0) break;
        contextText += entry;
        usedChars += entry.length;
    }

    return [
        "You are a highly analytical research assistant. Use the reference material below to answer the user's question.",
        'IMPORTANT: You must establish an ability to reason internally. Double-check your facts for accuracy based on the reference material before presenting your single, unified final response. Break down your logic step-by-step.',
        'Write a clear, concise final answer in your own words. Do NOT copy-paste the source text.',
        'Mention source numbers like [1] when you use information from them.',
        'NEVER fabricate, invent, or hallucinate citations, DOIs, paper titles, author names, journal names, or URLs. Only reference sources provided above.',
        "If the sources don't cover the question, say so briefly and suggest the user search for more information.",
        '',
        'Reference material:',
        contextText,
    ].join('\n');
}