/**
 * WebLLM wrapper – runs LLM inference locally in the renderer via WebGPU.
 *
 * No network requests to Ollama or any external API are made.
 * The model is downloaded once and cached in the browser's Cache API (IndexedDB).
 */

import * as webllm from '@mlc-ai/web-llm';
import { Zap, MessagesSquare, Sparkles, Sun, Cpu } from 'lucide-react'

export const DEFAULT_MODEL = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

// Shared model definitions available for download/use
export const AVAILABLE_MODELS = [
    { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 3B', icon: Zap, color: 'text-violet-400', contextWindow: 4096 },
    { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 1B', icon: MessagesSquare, color: 'text-emerald-400', contextWindow: 4096 },
    { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', name: 'Phi-3.5 Mini', icon: Sparkles, color: 'text-blue-400', contextWindow: 4096 },
    { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 1.5B', icon: Sun, color: 'text-orange-400', contextWindow: 8192 },
    { id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 7B', icon: Sun, color: 'text-yellow-400', contextWindow: 8192 },
    { id: 'gemma-2b-it-q4f16_1-MLC', name: 'Gemma 2B', icon: Cpu, color: 'text-green-400', contextWindow: 4096 },
];

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

    if (_s.engine && _s.loadedModel !== model) {
        // Engine exists, but we want to load a different model.
        if (onProgress) _s.engine.setInitProgressCallback(onProgress);
        _s.promise = _s.engine.reload(model).then(() => {
            _s.loadedModel = model;
            _s.promise = null;
            return _s.engine;
        }).catch(err => {
            _s.promise = null; // allow retry on failure
            throw err;
        });
        return _s.promise;
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

/** Check if model exists in IndexedDB cache */
export async function checkModelCached(modelId) {
    return await webllm.hasModelInCache(modelId);
}

/** Delete a model from IndexedDB cache */
export async function deleteModel(modelId) {
    if (_s.engine && _s.loadedModel === modelId) {
        // If it's the currently active model, we need to unload it
        _s.engine.unload();
        _s.engine = null;
        _s.loadedModel = null;
    }
    await webllm.deleteModelAllInfoInCache(modelId);
}

// ── Context-window guard ──────────────────────────────────

/** Rough token estimator: ~4 chars per token for English / code text. */
function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}

function getPromptTokenBudget() {
    // If a model is loaded, calculate based on its capacity, otherwise default to 4096 capacity.
    const model = AVAILABLE_MODELS.find(m => m.id === _s.loadedModel);
    const windowSize = model?.contextWindow || 4096;
    // Reserve ~900 tokens for the completion; the remaining is the prompt budget.
    return windowSize - 900;
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
    const turns = messages.filter(m => m.role !== 'system');

    // Ensure we always keep a small number of the most recent turns
    const MIN_TURNS_TO_KEEP = 4

    let budget = getPromptTokenBudget() -
        system.reduce((s, m) => s + estimateTokens(m.content), 0);

    const kept = [];
    for (let i = turns.length - 1; i >= 0; i--) {
        const cost = estimateTokens(turns[i].content);
        // If budget would be exceeded, stop only when we've already
        // preserved the minimum number of recent turns. This avoids
        // dropping essential conversational context when the system
        // prompt is large.
        if (budget - cost < 0 && kept.length > 0 && kept.length >= MIN_TURNS_TO_KEEP) break;
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
 * Extract strict formatting metrics and the core goal from the user's query.
 *
 * @param {string} userQuery
 * @returns {Promise<string>} The goal/format requirement.
 */
export async function formulateGoal(userQuery) {
    if (!_s.engine) return 'Standard answer';

    const goal = await complete([
        {
            role: 'system',
            content:
                'You are an intent-analysis agent. Read the user question and determine if they have STRICT FORMATTING or STRUCTURAL requirements (e.g., "write an abstract", "format as an IEEE paper", "give me exactly 5 bullet points", "write a python script").\n\n' +
                'If they do, output a concise 1-2 sentence instruction describing exactly what the final output MUST look like.\n' +
                'If it is just a normal question without strict structural demands, output exactly: "Standard answer".\n\n' +
                'Do NOT answer the question. Only output the formatting goal.\n' +
                'Example 1:\nUser: "write an abstract on semantic segmentation using IEEE papers"\nOutput: "The final answer MUST be formatted as a formal academic abstract synthesizing semantic segmentation using IEEE paper citations."\n\n' +
                'Example 2:\nUser: "what is the capital of france"\nOutput: "Standard answer"'
        },
        { role: 'user', content: userQuery }
    ], { maxTokens: 80 });

    return goal || 'Standard answer';
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
 * @returns {Promise<{ actions: Array<{ tool: string, args: Record<string, string> }>, pageCap: number }>}
 */
export async function planActions(userQuery, mode = 'ask', conversationHistory = []) {
    if (!_s.engine) return { actions: [], pageCap: 2 };

    const modeRules = mode === 'research'
        ? [
            'Mode: deep research.',
            '- You MUST ALWAYS output at least one web_search action unless the question is completely trivial.',
            '- Prefer broader evidence collection for deep analysis.',
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
                '- For web_search: write 2-4 short, keyword-focused queries (one web_search per query). Do NOT copy the user sentence verbatim. Resolve any pronouns or references using conversation history. Do NOT use boolean operators (AND, OR, NOT), quotes, wildcards, or advanced search syntax. Plain keywords only.\n' +
                '- For read_url: extract the exact URL from the user message.\n' +
                '- For knowledge_search: write a concise search phrase.\n' +
                '- You may combine tools (e.g. knowledge_search + web_search).\n' +
                '- IMPORTANT: If the user asks you to "write", "summarize", "analyze", or "explain" a topic, you MUST use web_search to find evidence first. Never output "none" for these tasks.\n' +
                '- Always output exactly one line starting with "page_cap: N", where N is 1, 2, or 3 based on evidence depth needed.\n' +
                '  - Use page_cap: 1 for single-source quick facts (weather, exchange rate, price-like lookups).\n' +
                '  - Use page_cap: 2 for most normal questions.\n' +
                '  - Use page_cap: 3 for high-stakes, nuanced, or likely-conflicting information.\n' +
                '- If no tools are needed, reply with exactly: none\n\n' +
                'Output format:\n' +
                'page_cap: N\n' +
                'tool_name: argument\n\n' +
                'Examples:\n\n' +
                'User: "What is the latest news on SpaceX?"\n' +
                'page_cap: 2\n' +
                'web_search: SpaceX latest news 2025\n' +
                'web_search: SpaceX Starship launch update\n\n' +
                'User: "Summarize this article https://example.com/post"\n' +
                'page_cap: 1\n' +
                'read_url: https://example.com/post\n\n' +
                'User: "What did I read about quantum computing last week?"\n' +
                'page_cap: 2\n' +
                'knowledge_search: quantum computing\n\n' +
                'User: "From the React docs, explain useEffect"\n' +
                'page_cap: 2\n' +
                'read_url: https://react.dev/reference/react/useEffect\n' +
                'web_search: React useEffect hook explained\n\n' +
                'User: "What is 2 + 2?"\n' +
                'none\n\n' +
                'Conversation: user asked about Go TUI libraries, assistant answered with tview and bubbletea.\n' +
                'User: "any other alternatives?"\n' +
                'page_cap: 2\n' +
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
        return { actions: [], pageCap: 2 };
    }
}

/**
 * Ask the model to output a structured TaskNode JSON array for a task-graph executor.
 * Each node: { id?: string, tool: string, args?: object, deps?: string[], priority?: number }
 */
export async function planToTaskNodes(userQuery, mode = 'ask', conversationHistory = []) {
    if (!_s.engine) return { nodes: [], pageCap: 2 };

    const prompt = [
        {
            role: 'system',
            content:
                'You are a planner for a task-graph executor. Given a user query, output a JSON array (only JSON, no surrounding text) of TaskNode objects. ' +
                'A TaskNode has the shape: { "id"?: string, "tool": "web_search"|"read_url"|"knowledge_search", "args": {...}, "deps": ["id1",...], "priority": number }.\n' +
                'Keep ids short and URL-safe. Ensure dependencies reference other node ids if needed. Do NOT include any other fields.'
        },
        { role: 'user', content: `User query: ${userQuery}\nMode: ${mode}` }
    ];

    try {
        const text = await complete(prompt, { maxTokens: 300 });
        // Try to parse JSON strictly
        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch (err) {
            // Attempt to extract JSON block
            const m = text.match(/([\[\{][\s\S]*[\]\}])/m);
            if (m) parsed = JSON.parse(m[1]);
        }

        if (!Array.isArray(parsed)) return { nodes: [], pageCap: 2 };
        // Normalize nodes
        const nodes = parsed.map(n => ({ id: n.id, tool: n.tool || n.name || n.toolId, args: n.args || {}, deps: n.deps || [], priority: n.priority || 0 }));
        return { nodes, pageCap: 2 };
    } catch (err) {
        return { nodes: [], pageCap: 2 };
    }
}

/**
 * Parse the model's action plan output into structured actions.
 * @param {string} text
 * @returns {{ actions: Array<{ tool: string, args: Record<string, string> }>, pageCap: number }}
 */
function parseActionPlan(text) {
    const trimmed = text.trim();
    if (/^none$/i.test(trimmed)) return { actions: [], pageCap: 2 };

    const actions = [];
    let pageCap = 2;
    for (const line of trimmed.split('\n')) {
        const clean = line.trim();
        if (!clean || /^none$/i.test(clean)) continue;

        const capMatch = clean.match(/^page_cap:\s*([123])/i);
        if (capMatch) {
            pageCap = parseInt(capMatch[1], 10);
            continue;
        }

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
    return { actions: actions.slice(0, 6), pageCap };
}
