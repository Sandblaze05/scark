/**
 * WebLLM wrapper – runs LLM inference locally in the renderer via WebGPU.
 *
 * No network requests to Ollama or any external API are made.
 * The model is downloaded once and cached in the browser's Cache API (IndexedDB).
 */

import * as webllm from '@mlc-ai/web-llm';

export const DEFAULT_MODEL = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

// Persist engine state on globalThis so HMR module reloads don't destroy an
// already-loaded engine or create duplicate initialisation.  In production the
// module is loaded once and this is a no-op.
// `worker` is also stored here so the same Web Worker thread is reused across
// HMR reloads instead of spawning a fresh one every time.
if (!globalThis.__webllmState) {
    globalThis.__webllmState = { engine: null, promise: null, loadedModel: null, worker: null };
}
const _s = globalThis.__webllmState;

/**
 * Initialise (or reuse) the WebLLM engine.
 *
 * @param {string} [model]
 * @param {(report: import('@mlc-ai/web-llm').InitProgressReport) => void} [onProgress]
 * @returns {Promise<import('@mlc-ai/web-llm').MLCEngine>}
 */
export function initEngine(model = DEFAULT_MODEL, onProgress) {
    // Return cached engine if the same model is already loaded
    if (_s.engine && _s.loadedModel === model) return Promise.resolve(_s.engine);

    // Return in-flight promise to avoid double-init
    if (_s.promise) return _s.promise;

    // Lazily create the worker once; reuse on HMR.
    if (!_s.worker) {
        _s.worker = new Worker(
            new URL('./webllmWorker.js', import.meta.url),
            { type: 'module' }
        );
    }

    _s.promise = webllm.CreateWebWorkerMLCEngine(_s.worker, model, {
        initProgressCallback: onProgress,
    }).then(engine => {
        _s.engine = engine;
        _s.loadedModel = model;
        _s.promise = null;
        return engine;
    }).catch(err => {
        _s.promise = null; // allow retry on failure
        throw err;
    });

    return _s.promise;
}

/** @returns {boolean} */
export function isEngineReady() {
    return _s.engine !== null;
}

// ── Context-window guard ──────────────────────────────────

// Llama-3.2-3B has a 4096-token context window.  Reserve ~900 tokens for the
// completion; the remaining ~3200 is the prompt budget.
const PROMPT_TOKEN_BUDGET = 3200;

/** Rough token estimator: ~4 chars per token for English / code text. */
function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}

/**
 * Trim a message list so it fits within PROMPT_TOKEN_BUDGET tokens.
 *
 * Strategy:
 *  1. Always keep every system message at the front.
 *  2. Walk non-system messages from newest → oldest, accumulating until the
 *     budget is exhausted.  At least the last message is always kept.
 */
function trimMessages(messages) {
    const system = messages.filter(m => m.role === 'system');
    const turns  = messages.filter(m => m.role !== 'system');

    let budget = PROMPT_TOKEN_BUDGET -
        system.reduce((s, m) => s + estimateTokens(m.content), 0);

    const kept = [];
    for (let i = turns.length - 1; i >= 0; i--) {
        const cost = estimateTokens(turns[i].content);
        if (budget - cost < 0 && kept.length > 0) break; // always keep at least 1
        kept.unshift(turns[i]);
        budget -= cost;
    }

    return [...system, ...kept];
}

/**
 * Stream chat completion tokens from the local WebLLM engine.
 *
 * @param {Array<{ role: string, content: string }>} messages
 * @param {{ signal?: AbortSignal }} [opts]
 * @yields {string} token strings
 */
export async function* streamChat(messages, { signal } = {}) {
    if (!_s.engine) throw new Error('WebLLM engine is not initialised. Call initEngine() first.');

    const stream = await _s.engine.chat.completions.create({
        messages: trimMessages(messages),
        stream: true,
        stream_options: { include_usage: false },
    });

    for await (const chunk of stream) {
        if (signal?.aborted) {
            await _s.engine.interruptGenerate();
            break;
        }
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
    }
}

/**
 * Non-streaming completion – used for short utility calls like query rewriting.
 *
 * @param {Array<{ role: string, content: string }>} messages
 * @param {{ signal?: AbortSignal, maxTokens?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function complete(messages, { signal, maxTokens } = {}) {
    if (!_s.engine) throw new Error('WebLLM engine is not initialised. Call initEngine() first.');

    const result = await _s.engine.chat.completions.create({
        messages: trimMessages(messages),
        stream: false,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
    });

    return result.choices[0]?.message?.content?.trim() ?? '';
}

/**
 * Ask the model to plan a batch of crawler-optimised web search queries.
 * Kept for backward compatibility — delegates to planActions internally.
 *
 * @param {string} userQuery
 * @returns {Promise<{ needsSearch: boolean, queries: string[] }>}
 */
export async function planSearchQueries(userQuery) {
    const { actions } = await planActions(userQuery);
    const searchActions = actions.filter(a => a.tool === 'web_search');
    return {
        needsSearch: searchActions.length > 0,
        queries: searchActions.map(a => a.args.query),
    };
}

/**
 * Ask-mode evidence depth estimator.
 *
 * Returns how many pages should be crawled per web_search action.
 * 1 page  -> single-source factual lookup (weather, stock quote, quick fact)
 * 2 pages -> normal ask queries
 * 3 pages -> higher-stakes or potentially conflicting facts
 *
 * @param {string} userQuery
 * @returns {Promise<number>} integer in [1, 3]
 */
export async function decideAskPageCap(userQuery) {
    if (!_s.engine) return 2;

    const messages = [
        {
            role: 'system',
            content:
                'You decide web evidence depth for ASK mode.\n' +
                'Output exactly one integer: 1, 2, or 3.\n\n' +
                'Use 1 for single-source quick facts (weather, exchange rate, price-like lookups).\n' +
                'Use 2 for most normal questions.\n' +
                'Use 3 for high-stakes, nuanced, or likely-conflicting information.\n' +
                'Do not output any words, punctuation, or explanation.',
        },
        { role: 'user', content: userQuery },
    ];

    try {
        const text = await complete(messages, { maxTokens: 4 });
        const match = text.match(/[123]/);
        const value = match ? Number(match[0]) : 2;
        return Math.min(3, Math.max(1, value));
    } catch (_) {
        return 2;
    }
}

/**
 * Ask the model to decide which tools to use for the user's query.
 *
 * Available tools:
 *   web_search(query)      – search the web for current / factual information
 *   read_url(url)          – fetch and read a specific URL / source
 *   knowledge_search(query)– search local knowledge base for previously stored info
 *   none                   – answer from training knowledge alone
 *
 * Returns an array of actions the model wants to execute.
 * Capped at 120 output tokens so the planning probe stays fast.
 *
 * @param {string} userQuery
 * @param {'ask'|'research'} [mode]
 * @returns {Promise<{ actions: Array<{ tool: string, args: Record<string, string> }> }>}
 */
export async function planActions(userQuery, mode = 'ask', conversationHistory = []) {
    if (!_s.engine) return { actions: [] };

    const modeRules = mode === 'research'
        ? [
            'Mode: deep research.',
            '- Prefer broader evidence collection.',
            '- You may propose up to 6 actions total.',
            '- Include multiple web_search lines when evidence breadth helps.',
            '- Include read_url when the user references specific URLs/sources.',
        ].join('\n')
        : [
            'Mode: ask (fast answer).',
            '- Prefer minimal, high-value tool usage.',
            '- Use 0-3 actions total when possible.',
            '- Only use web_search when current/uncertain facts are required.',
        ].join('\n');

    // Include recent conversation history so the model can resolve
    // follow-up references like "some other alternative?" or "tell me more".
    const recentTurns = conversationHistory
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-4);
    let historyBlock = '';
    if (recentTurns.length > 0) {
        historyBlock = '\nRecent conversation (use this to understand follow-up questions):\n' +
            recentTurns.map(m => `${m.role}: ${(m.content || '').slice(0, 200)}`).join('\n') +
            '\n';
    }

    const planMessages = [
        {
            role: 'system',
            content:
                'You are a tool-planning agent. Given a user question and optional conversation history, decide which tools (if any) would help answer it.\n' +
                'IMPORTANT: If the user\'s latest message is a follow-up (e.g. "any alternatives?", "tell me more", "what about X?"), you MUST use the conversation history to understand the actual topic, then write search queries about THAT topic. Never invent an unrelated topic.\n\n' +
                'Available tools:\n' +
                '  web_search(query)       – search the internet. Use when the question needs current, real-time, or factual data you are unsure about.\n' +
                '  read_url(url)           – fetch a specific webpage. Use when the user mentions a specific website, link, source, or documentation.\n' +
                '  knowledge_search(query) – search locally stored knowledge. Use when the user asks about something that may have been researched before.\n' +
                '  none                    – no tools needed. Use when your training knowledge is sufficient.\n\n' +
                modeRules + '\n\n' +
                'Rules:\n' +
                '- Output one tool call per line.\n' +
                '- For web_search: write 2-4 short, keyword-focused queries (one web_search per query). Do NOT copy the user sentence verbatim. Resolve any pronouns or references using conversation history.\n' +
                '- For read_url: extract the exact URL from the user message.\n' +
                '- For knowledge_search: write a concise search phrase.\n' +
                '- You may combine tools (e.g. knowledge_search + web_search).\n' +
                '- If no tools are needed, reply with exactly: none\n\n' +
                'Output format (one per line):\n' +
                'tool_name: argument\n\n' +
                'Examples:\n\n' +
                'User: "What is the latest news on SpaceX?"\n' +
                'web_search: SpaceX latest news 2025\n' +
                'web_search: SpaceX Starship launch update\n\n' +
                'User: "Summarize this article https://example.com/post"\n' +
                'read_url: https://example.com/post\n\n' +
                'User: "What did I read about quantum computing last week?"\n' +
                'knowledge_search: quantum computing\n\n' +
                'User: "From the React docs, explain useEffect"\n' +
                'read_url: https://react.dev/reference/react/useEffect\n' +
                'web_search: React useEffect hook explained\n\n' +
                'User: "What is 2 + 2?"\n' +
                'none\n\n' +
                'Conversation: user asked about Go TUI libraries, assistant answered with tview and bubbletea.\n' +
                'User: "any other alternatives?"\n' +
                'web_search: Go TUI library alternatives\n' +
                'knowledge_search: Go terminal UI frameworks' +
                historyBlock,
        },
        { role: 'user', content: userQuery },
    ];

    try {
        const text = await complete(planMessages, { maxTokens: 120 });
        return parseActionPlan(text);
    } catch (_) {
        return { actions: [] };
    }
}

/**
 * Parse the model's action plan output into structured actions.
 * @param {string} text
 * @returns {{ actions: Array<{ tool: string, args: Record<string, string> }> }}
 */
function parseActionPlan(text) {
    const trimmed = text.trim();
    if (/^none$/i.test(trimmed)) return { actions: [] };

    const actions = [];
    for (const line of trimmed.split('\n')) {
        const clean = line.trim();
        if (!clean || /^none$/i.test(clean)) continue;

        // Match "tool_name: argument"
        const match = clean.match(/^(web_search|read_url|knowledge_search):\s*(.+)$/i);
        if (match) {
            const tool = match[1].toLowerCase();
            const arg = match[2].trim();
            if (tool === 'read_url') {
                // Validate it looks like a URL
                if (/^https?:\/\//i.test(arg)) {
                    actions.push({ tool, args: { url: arg } });
                }
            } else if (tool === 'web_search') {
                actions.push({ tool, args: { query: arg } });
            } else if (tool === 'knowledge_search') {
                actions.push({ tool, args: { query: arg } });
            }
        }
    }

    // Cap total actions to prevent runaway
    return { actions: actions.slice(0, 6) };
}
