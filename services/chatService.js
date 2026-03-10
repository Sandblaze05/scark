/**
 * Chat Service – Ollama Chat API (streaming)
 *
 * Streams chat completions from a local Qwen-3 model via Ollama.
 * Used by the Electron main process to power the RAG chat pipeline.
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const CHAT_MODEL = process.env.CHAT_MODEL || 'gemma3:1b';

/**
 * Rewrite a follow-up message into a standalone search query by resolving
 * pronouns and context from the conversation history.
 *
 * @param {Array<{ role: string, content: string }>} messages - full conversation
 * @returns {Promise<string>} standalone search query
 */
export async function rewriteQuery(messages) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return '';

    // If there's only one user message, it's already standalone
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length <= 1) return lastUser.content;

    // Use the actual conversation messages (not a stringified dump) so
    // the model sees proper role boundaries.  Keep it short: last 6 turns.
    const recent = messages.slice(-6);

    const rewriteMessages = [
        {
            role: 'system',
            content: [
                'Your ONLY job is to rewrite the user\'s latest question into a fully self-contained web search query.',
                'Replace every pronoun (he, she, they, it, etc.) and vague reference (the movie, that thing, etc.) with the actual name or topic from the conversation.',
                'Keep the rewritten query short (under 15 words).',
                '',
                'Rules:',
                '- Output ONLY the rewritten search query.',
                '- Do NOT answer the question.',
                '- Do NOT add quotes, labels, or explanations.',
                '- If the last message is already self-contained, output it unchanged.',
                '',
                'Examples:',
                'Conversation: "Who is Markiplier?" → "He made a movie recently, what\'s it called?"',
                'Rewrite: What movie did Markiplier make recently',
                '',
                'Conversation: "Tell me about Tesla" → "Who founded it?"',
                'Rewrite: Who founded Tesla',
                '',
                'Conversation: "Who is PewDiePie?" → "What\'s he been up to lately?"',
                'Rewrite: What has PewDiePie been doing lately',
            ].join('\n'),
        },
        ...recent,
        {
            role: 'user',
            content: `Rewrite the last user message as a standalone search query:`,
        },
    ];

    try {
        const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: CHAT_MODEL,
                stream: false,
                messages: rewriteMessages,
            }),
        });

        if (!res.ok) {
            console.warn('[rewriteQuery] Ollama call failed, using original query');
            return lastUser.content;
        }

        const data = await res.json();
        let rewritten = data.message?.content?.trim() || '';

        // Strip quotes the model might wrap around the query
        rewritten = rewritten.replace(/^["']+|["']+$/g, '').trim();

        // Reject if empty, too long, or looks like an answer instead of a query
        if (!rewritten || rewritten.length > 200 || rewritten.split(' ').length > 25) {
            console.warn(`[rewriteQuery] Bad rewrite, falling back: "${rewritten}"`);
            return lastUser.content;
        }

        console.log(`[rewriteQuery] "${lastUser.content}" → "${rewritten}"`);
        return rewritten;
    } catch (err) {
        console.warn('[rewriteQuery] Error:', err.message);
        return lastUser.content;
    }
}

/**
 * Build a system prompt that includes retrieved context chunks.
 *
 * @param {Array<{ title: string, url: string, text: string }>} contextChunks
 * @returns {string}
 */
export function buildSystemPrompt(contextChunks) {
    if (!contextChunks || contextChunks.length === 0) {
        return 'You are a helpful assistant. Answer the user\'s question to the best of your ability.';
    }

    const contextText = contextChunks
        .map((c, i) => `[${i + 1}] ${c.text}`)
        .join('\n\n');

    return [
        'You are a helpful research assistant. Use the reference material below to answer the user\'s question.',
        'Write a clear, concise answer in your own words. Do NOT copy-paste the source text.',
        'Mention source numbers like [1] when you use information from them.',
        'If the sources don\'t cover the question, say so briefly.',
        '',
        'Reference material:',
        contextText,
    ].join('\n');
}

/**
 * Stream chat completion tokens from Ollama.
 *
 * @param {Array<{ role: string, content: string }>} messages
 * @param {object} [opts]
 * @param {string} [opts.model]
 * @yields {string} individual token strings
 */
export async function* streamChat(messages, opts = {}) {
    const model = opts.model || CHAT_MODEL;

    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Ollama chat failed (${res.status}): ${body}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line);
                    if (data.message?.content) {
                        yield data.message.content;
                    }
                } catch { /* skip malformed JSON lines */ }
            }
        }

        if (buffer.trim()) {
            try {
                const data = JSON.parse(buffer);
                if (data.message?.content) {
                    yield data.message.content;
                }
            } catch { /* ignore */ }
        }
    } finally {
        reader.releaseLock();
    }
}
