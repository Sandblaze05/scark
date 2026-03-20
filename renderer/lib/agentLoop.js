/**
 * Deliberation-based agent controller
 *
 * Architecture: State + Plan (TaskGraph) → Deliberate → Execute Tasks → Update → Loop
 *
 * Rather than a reactive closed-loop that classifies the next action at each step,
 * this agent uses two explicit deliberation checkpoints to populate a TaskGraph that
 * covers the entire pipeline. The executor simply drains ready tasks from the graph.
 *
 * Deliberation checkpoints:
 *   START         — LLM reads query + goal, emits initial retrieval task nodes
 *   POST_RETRIEVE — LLM assesses gathered evidence, emits draft-phase task nodes
 *
 * Post-reflect routing is verdict-driven (pure code, no extra LLM call):
 *   PASS     → schedule finalize
 *   RETRY    → schedule new draft node (deps: [reflect])
 *   RESEARCH → schedule fallback search nodes + draft node (deps: [reflect, searches])
 *
 * Task types (toolId):
 *   web_search / read_url / knowledge_search — evidence retrieval
 *   summarize   — evidence compression (research mode only)
 *   draft       — produce an answer draft
 *   reflect     — evaluate draft quality (auto-scheduled after each draft)
 *   finalize    — stream the final answer (terminal node)
 *
 * TaskGraph improvements:
 *   hasActiveTool(toolId)   — check if a toolId is pending/active
 *   getNodesByTool(toolId)  — get all nodes for a toolId
 *   isExhausted()           — all nodes terminal (completed or failed)
 *   collectDepResults(deps) — gather results from completed dep nodes
 *   getSummary()            — compact object for LLM deliberation context
 */

import {
  complete as webllmComplete,
  streamChat as webllmStreamChat,
  formulateGoal,
} from './webllm.js'
import { runTool, registerDefaultAdapters, listTools, isRegisteredTool, getToolCategory, getRetrievalToolIds, getToolStatusLabel, getToolRoadmapLabel, isRetryable } from './toolRegistry.js'
import { TaskGraph } from './taskGraph.js'

// ── Constants ──────────────────────────────────────────────────

const MAX_STEPS = 14
const MAX_DRAFT_RETRIES = 2
const WEB_SEARCH_TIMEOUT_GRACE_MS = 7000
const WEB_SEARCH_STATUS_POLL_MS = 350
const TASK_TIMEOUT_GRACE_MS = 7000
const TASK_STATUS_POLL_MS = 350

// ── Query sanitizer ────────────────────────────────────────────

function sanitizeSearchQuery(raw) {
  const cleaned = (raw || '')
    .replace(/\b(AND|OR|NOT)\b/g, ' ')
    .replace(/\b\w+:/g, ' ')
    .replace(/[?*]+/g, '')
    .replace(/[()]/g, ' ')
    .replace(/"/g, ' ')
    .replace(/-\s*\S+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    || raw.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 6).join(' ')

  const words = cleaned.split(/\s+/)
  return words.length > 10 ? words.slice(0, 10).join(' ') : cleaned
}

function normalizeUrl(raw) {
  const input = (raw || '').trim()
  if (!input) return ''

  let candidate = input
    .replace(/^read\s*:\s*/i, '')
    .replace(/^url\s*:\s*/i, '')
    .replace(/[<>'"`]/g, '')
    .trim()

  if (candidate.startsWith('//')) candidate = `https:${candidate}`

  if (!/^https?:\/\//i.test(candidate) && /^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(candidate)) {
    candidate = `https://${candidate}`
  }

  try {
    return new URL(candidate).toString()
  } catch {
    return candidate
  }
}

function isContextDependentFollowUp(text) {
  const msg = (text || '').trim()
  if (!msg) return false

  const shortMsg = msg.split(/\s+/).length <= 10
  const followUpSignals = /\b(it|its|this|that|those|these|they|them|his|her|their|other|alternative|more|else|another|similar|instead|too|also|what about|and what|then what)\b/i
  return shortMsg && followUpSignals.test(msg)
}

function buildContextAnchoredQuery(query, conversationHistory = []) {
  const latest = (query || '').trim()
  if (!latest) return ''
  if (!isContextDependentFollowUp(latest)) return latest

  const priorUserTurns = (conversationHistory || [])
    .filter(m => m?.role === 'user' && typeof m?.content === 'string')
    .map(m => m.content.trim())
    .filter(Boolean)

  const previous = priorUserTurns[priorUserTurns.length - 1]
  if (!previous) return latest
  return `${previous.slice(0, 140)} - ${latest}`
}

function buildRecentConversationBlock(messages = [], maxTurns = 6) {
  const turns = (messages || [])
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .slice(-maxTurns)

  if (turns.length === 0) return 'none'
  return turns
    .map(m => `${m.role}: ${m.content.replace(/\s+/g, ' ').trim().slice(0, 220)}`)
    .join('\n')
}

function buildShortTermMemoryBlock(shortTermContext = [], maxTurns = 8) {
  const turns = (shortTermContext || [])
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .slice(-maxTurns)

  if (turns.length === 0) return 'none'
  return turns
    .map(m => `${m.role}: ${m.content.replace(/\s+/g, ' ').trim().slice(0, 260)}`)
    .join('\n')
}

function buildMemoryPromptPrefix(state) {
  const shortTerm = buildShortTermMemoryBlock(state.shortTermContext, 8)
  const midTerm = (state.conversationSummary || '').replace(/\s+/g, ' ').trim()
  const notes = (state.userNotes || '').trim()

  return [
    'Conversation memory:',
    `Short-term context (recent turns):\n${shortTerm}`,
    `Mid-term context (rolling summary):\n${midTerm || 'none'}`,
    notes
      ? `Persistent user notes (cross-chat, high priority):\n${notes}`
      : null,
    'Use this memory to resolve references and preserve continuity. If there is a conflict, trust recent turns over summary. User notes override summary for preferences/identity.',
  ].filter(Boolean).join('\n\n')
}

// ── User notes extractor ───────────────────────────────────────
// Called AFTER a successful finalize to decide whether anything worth
// remembering globally was revealed. Returns the merged notes string
// (≤ 200 chars) or null if nothing new.

export async function extractUserNotes(query, assistantText, existingNotes = '') {
  try {
    const text = await webllmComplete(
      [
        {
          role: 'system',
          content:
            'You maintain a compact global memory of persistent user facts.\n\n' +
            'Given the latest exchange, decide whether it reveals something durable to remember:\n' +
            '  - Explicit preference or dislike ("I prefer X", "I hate Y")\n' +
            '  - Name, role, location, or stable identity fact\n' +
            '  - Recurring topic interest\n' +
            '  - Explicit constraint or goal the user repeats\n\n' +
            'Rules:\n' +
            '- If nothing durable was revealed, reply with exactly: NULL\n' +
            '- Otherwise, output ONLY the updated notes (merge old + new, max 200 chars).\n' +
            '- Write as a tight comma-separated list of facts, no markdown, no preamble.\n' +
            '- Remove contradicted old facts.',
        },
        {
          role: 'user',
          content:
            `Existing notes: ${existingNotes || '(none)'}\n` +
            `User: ${query.slice(0, 300)}\n` +
            `Assistant: ${assistantText.slice(0, 400)}`,
        },
      ],
      { maxTokens: 60 },
    )

    const result = (text || '').trim()
    if (!result || result.toUpperCase() === 'NULL') return null
    return result.slice(0, 220) // hard cap
  } catch {
    return null
  }
}

// ── Query track classifier ─────────────────────────────────────
// Classifies the incoming query into one of three execution tracks BEFORE the
// main loop starts, so trivial / conversational queries never pay the cost of
// deliberation + retrieval.
//
//   DIRECT   — answer is in-context; skip to finalize immediately.
//              (greetings, simple math, follow-ups answerable from history)
//   STANDARD — normal ask-mode pipeline (1 retrieval → draft → reflect → finalize)
//   RESEARCH — deep research pipeline (multi-retrieval → summarize → draft → …)

async function classifyQuery(query, conversationHistory = [], mode) {
  // Research mode is never DIRECT — always run the full pipeline.
  if (mode === 'research') return 'RESEARCH'

  const recentConvo = buildRecentConversationBlock(conversationHistory, 4)

  try {
    const text = await webllmComplete(
      [
        {
          role: 'system',
          content:
            'Classify the user query into exactly one track. Reply with ONLY the track name.\n\n' +
            'DIRECT  → The query is a greeting, simple arithmetic/unit conversion, ' +
            'or a short follow-up that can be answered fully from the conversation below ' +
            '(no external information needed).\n' +
            'STANDARD → Needs 1–2 retrieval actions (web search / knowledge base) to answer well.\n' +
            'RESEARCH → Requires deep multi-source investigation (unlikely unless mode=research).\n\n' +
            'Examples of DIRECT: "hello", "thanks", "what is 12*7", ' +
            '"what did you just say", "can you shorten that", "in km please"\n' +
            'Examples of STANDARD: "latest news on X", "how does Y work", "what is Z"\n\n' +
            'Output ONLY one word: DIRECT, STANDARD, or RESEARCH.',
        },
        {
          role: 'user',
          content:
            `Recent conversation:\n${recentConvo}\n\nNew query: ${query}`,
        },
      ],
      { maxTokens: 5 },
    )

    const track = (text || '').trim().toUpperCase().split(/\s+/)[0]
    if (track === 'DIRECT' || track === 'STANDARD' || track === 'RESEARCH') return track
  } catch { /* fall through */ }

  // Heuristic fallback: short messages with follow-up signals → DIRECT
  if (isContextDependentFollowUp(query) && conversationHistory.length > 0) return 'DIRECT'
  return 'STANDARD'
}

export async function recoverTimedOutTask(requestId, scark, abortCtrl, graceMs = TASK_TIMEOUT_GRACE_MS) {
  if (!requestId || !scark?.query?.taskStatus) return null

  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (abortCtrl?.signal?.aborted) {
      const abortErr = new Error('Aborted')
      abortErr.name = 'AbortError'
      throw abortErr
    }

    const status = await scark.query.taskStatus(requestId).catch(() => null)
    if (!status) {
      await sleep(TASK_STATUS_POLL_MS)
      continue
    }

    if (status.status === 'completed' || status.status === 'failed' || status.status === 'busy' || status.status === 'canceled') {
      return status.response || { status: status.status, reason: '', results: [], meta: { requestId } }
    }

    await sleep(TASK_STATUS_POLL_MS)
  }

  return null
}

// ── Query rewriter ─────────────────────────────────────────────

async function rewriteFailedQuery(originalQuery, errorMsg) {
  const text = await webllmComplete([
    {
      role: 'system',
      content:
        'The previous web search failed or timed out. Rewrite the query to be shorter, ' +
        'more keyword-focused, and more likely to return results quickly.\n\n' +
        'Rules:\n' +
        '- Maximum 6 words\n' +
        '- Remove filler words, dates, qualifiers\n' +
        '- Keep only the core topic keywords\n' +
        '- Do NOT use boolean operators, quotes, or advanced syntax\n' +
        '- Output ONLY the rewritten query as plain keywords, nothing else',
    },
    {
      role: 'user',
      content: `Original query: "${originalQuery}"\nError: ${errorMsg || 'timeout'}`,
    },
  ], { maxTokens: 25 })

  const rewritten = (text || '').trim().split('\n')[0].replace(/['"]/g, '').trim()
  return sanitizeSearchQuery(rewritten || originalQuery.split(' ').slice(0, 4).join(' '))
}

// (executeTool and tool execution was migrated to toolRegistry.js)

// ── System prompt builder ──────────────────────────────────────

function buildSystemPrompt(mode, docs, fallbackPrompt) {
  const knowledgePrompt = docs.find(d => d.type === 'knowledge_prompt')?.text
  const docItems = docs.filter(d => d.type !== 'knowledge_prompt' && d.text)

  const charBudget = mode === 'research' ? 6400 : 4800
  let used = 0
  let contextText = ''
  const usedDocs = []

  for (const d of docItems) {
    const remaining = charBudget - used
    if (remaining <= 0) break
    const maxLen = Math.max(0, remaining - 100)
    if (maxLen < 200 && usedDocs.length > 0) break

    const ts = d.timestamp ? ` (Date: ${d.timestamp})` : ''
    const safeText = d.text.length > maxLen
      ? d.text.slice(0, maxLen) + '\n...[truncated]'
      : d.text
    const entry = `[${usedDocs.length + 1}]${ts} ${d.title || d.url}\n${safeText}\n\n`

    used += entry.length
    usedDocs.push(d)
    contextText += entry
  }

  const basePrompt = knowledgePrompt || fallbackPrompt || 'You are a helpful assistant.'
  const modeInstruction = mode === 'research'
    ? 'Use evidence from sources, synthesize across documents, and call out uncertainty when sources conflict.'
    : 'Use evidence from sources when available and keep the answer direct.'

  const citationGuard =
    'CITATION RULES (CRITICAL):\n' +
    '- ONLY cite sources from the numbered Reference material using [1], [2], etc.\n' +
    '- NEVER invent, fabricate, or hallucinate citations, DOIs, paper titles, author names, URLs, or journal names.\n' +
    '- If a reference is not in your sources, state that you cannot verify it.\n'

  const kbSources = docs
    .filter(d => d.type === 'knowledge' && d.url && !usedDocs.find(u => u.url === d.url))
    .map(d => ({ title: d.title, url: d.url }))

  return {
    systemPrompt: `${basePrompt}\n\n${modeInstruction}\n${citationGuard}${contextText ? `\nReference material:\n${contextText}` : ''}`,
    sources: [...usedDocs.map(d => ({ title: d.title, url: d.url })), ...kbSources],
    docDigest: usedDocs.map((d, i) => `[${i + 1}] ${d.title || d.url}`).join('\n'),
  }
}

// ── Reflection pass ────────────────────────────────────────────

async function runReflection(query, draftText, mode, goalConstraint) {
  const text = await webllmComplete([
    {
      role: 'system',
      content:
        'You are a quality evaluator. Assess the draft against the query and any format constraint.\n\n' +
        `Format constraint: ${goalConstraint}\n\n` +
        'Return EXACTLY ONE verdict:\n' +
        'VERDICT: PASS  (draft answers the query AND follows the format constraint)\n' +
        'VERDICT: RETRY (format/tone is wrong but facts are present)\n' +
        'VERDICT: RESEARCH (lacks evidence, or contains fabricated citations)\n\n' +
        'Then output:\n' +
        'QUALITY: <0.0 to 1.0>\n' +
        'IMPROVEMENTS: <3-5 bullet points, or "none" if PASS>\n' +
        'MISSING_SOURCES: <If RESEARCH: 1-2 search queries separated by commas. Otherwise "none".>\n',
    },
    { role: 'user', content: `Question: ${query}\n\nDraft:\n${draftText}` },
  ], { maxTokens: 200 })

  const lines = (text || '').split('\n')
  let verdict = 'PASS', quality = 0.7, improvements = '', missingQueries = []

  for (const line of lines) {
    const vm = line.match(/^VERDICT:\s*(\w+)/i)
    if (vm) verdict = ['RETRY', 'RESEARCH'].includes(vm[1].toUpperCase()) ? vm[1].toUpperCase() : 'PASS'

    const qm = line.match(/^QUALITY:\s*([\d.]+)/i)
    if (qm) quality = Math.min(1, Math.max(0, parseFloat(qm[1])))

    if (/^IMPROVEMENTS?:/i.test(line)) {
      improvements = lines.slice(lines.indexOf(line) + 1)
        .filter(l => !/^MISSING_SOURCES:/i.test(l))
        .join('\n').trim()
    }

    const mm = line.match(/^MISSING_SOURCES:\s*(.+)/i)
    if (mm && mm[1].toLowerCase() !== 'none') {
      missingQueries = mm[1].split(',').map(s => s.trim()).filter(Boolean)
    }
  }

  const checklist = improvements
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l))
    .map(l => l.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 5)
    .join('\n')

  return { verdict, quality, improvements, missingQueries, checklist }
}

// ── Reasoning preview ──────────────────────────────────────────

function buildReasoningPreview(mode, stepLog, sourceCount, reflectionNotes) {
  const stepsText = stepLog.length
    ? stepLog.map((s, i) => `${i + 1}. ${s.action}${s.note ? ` → ${s.note}` : ''}`).join('\n')
    : '1. (direct answer)'

  const reflectionExcerpt = (reflectionNotes || '').replace(/\s+/g, ' ').trim().slice(0, 360)

  return [
    `Mode: ${mode === 'research' ? 'Deep Research' : 'Ask'}`,
    '',
    'Agent steps:',
    stepsText,
    '',
    `Retrieved sources: ${sourceCount}`,
    'Pipeline: deliberation-based task graph',
    reflectionExcerpt
      ? `Reflection: ${reflectionExcerpt}${reflectionNotes.length > 360 ? ' ...' : ''}`
      : 'Reflection: pending',
  ].join('\n')
}

// ── Deliberation ───────────────────────────────────────────────
//
// Called at two checkpoints. Returns structured task descriptions.
// Dependency wiring is handled by the scheduling helpers below —
// not by the LLM — keeping the prompt small and reliable.

async function deliberate(state, plan, checkpoint) {
  try { registerDefaultAdapters() } catch { }

  const summary = plan.getSummary()
  const recentConversation = buildRecentConversationBlock(
    state.newMessages?.length ? state.newMessages : state.conversationHistory,
    6,
  )

  const tools = listTools()
  const toolDefs = tools.map(t => `${t.id} (${t.name}: ${t.description})`).join('\n  - ')
  const toolIds = tools.map(t => t.id).join('|')

  const prompts = {
    /**
     * START: decide which retrieval tools to run.
     * Output: { assessment, tasks: [{ toolId, args: { query }, priority }] }
     */
    start:
      'You are a planning agent deciding which tools to run to gather evidence or context.\n\n' +
      `Available tools:\n  - ${toolDefs}\n\n` +
      'Output ONLY valid JSON — no markdown, no commentary:\n' +
      `{ "assessment": "<1 sentence>", "tasks": [ { "toolId": "${toolIds}", "args": { "query": "..." }, "priority": <1-10> } ] }\n\n` +
      'Rules:\n' +
      '- ask mode: 1–2 tasks. research mode: 2–4 tasks.\n' +
      '- trivial queries (greetings, simple math): empty tasks array.\n' +
      '- IMPORTANT: If the user asks about their own identity, name, profile, or preferences (e.g. "who am i", "what is my name", "my settings"), use get_user_settings — do NOT use web_search for personal identity questions.\n' +
      '- if the latest query is a follow-up, resolve references (it/that/his/other/etc.) using recent conversation before writing search queries.\n' +
      '- for read_url, args.query MUST be a concrete URL (prefer https://...).\n' +
      '- always sanitize queries to plain keywords, no boolean operators.',

    /**
     * POST_RETRIEVE: assess gathered evidence, decide next phase.
     * Output: { assessment, ready_to_draft, extra_searches: [{ query, priority }] }
     */
    post_retrieve:
      'You are a planning agent. Review gathered evidence and decide if a draft can be written.\n\n' +
      'Output ONLY valid JSON:\n' +
      '{ "assessment": "<1 sentence>", "ready_to_draft": true|false, "extra_searches": [ { "query": "...", "priority": <1-5> } ] }\n\n' +
      'Rules:\n' +
      '- If 1+ sources gathered and question is answerable: ready_to_draft = true.\n' +
      '- Only add extra_searches if critical evidence is clearly absent. Max 2.\n' +
      '- If no sources and no failures: ready_to_draft = false, add a search.',
  }

  const userContent = [
    `Query: ${state.queryForPlanning || state.query}`,
    `Latest user message: ${state.query}`,
    `Recent conversation:\n${recentConversation}`,
    `Mid-term summary:\n${state.conversationSummary || 'none'}`,
    `Goal: ${state.goal}`,
    `Mode: ${state.mode}`,
    `Steps used: ${state.stepCount}/${MAX_STEPS}`,
    state.gathered.length > 0
      ? `Evidence gathered:\n${state.gathered.map((g, i) => `  ${i + 1}. [${g.type}] ${g.title || 'Untitled'}`).join('\n')}`
      : 'Evidence gathered: none',
    checkpoint === 'post_retrieve'
      ? `Completed tasks: ${JSON.stringify(summary.completed)}\nFailed tasks: ${JSON.stringify(summary.failed)}`
      : '',
  ].filter(Boolean).join('\n')

  try {
    const text = await webllmComplete(
      [
        { role: 'system', content: prompts[checkpoint] },
        { role: 'user', content: userContent },
      ],
      { maxTokens: 250 },
    )
    return parseDeliberation(text, checkpoint, state, plan)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    return fallbackDeliberation(state, checkpoint)
  }
}

function parseDeliberation(text, checkpoint, state, plan) {
  try {
    const cleaned = (text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    const parsed = JSON.parse(cleaned)

    if (checkpoint === 'start') {
      try { registerDefaultAdapters() } catch { }
      const valid = new Set(listTools().map(t => t.id))
      const tasks = (parsed.tasks || [])
        .filter(t => valid.has(t.toolId) && (t.args?.query || t.args?.url || Object.keys(t.args || {}).length >= 0)) // Just allow args to be there
        .map(t => {
          const rawQuery = t.args?.query || ''
          if (t.toolId === 'read_url') {
            const url = normalizeUrl(rawQuery)
            return { ...t, args: { ...t.args, url, query: url } }
          }
          if (['web_search', 'knowledge_search'].includes(t.toolId)) {
            return { ...t, args: { ...t.args, query: sanitizeSearchQuery(rawQuery) } }
          }
          return t
        })
      return { assessment: parsed.assessment || '', tasks }
    }

    if (checkpoint === 'post_retrieve') {
      const extraSearches = (parsed.extra_searches || []).map(s => ({
        toolId: 'web_search',
        args: { query: sanitizeSearchQuery(s.query) },
        priority: s.priority || 4,
      }))
      return {
        assessment: parsed.assessment || '',
        readyToDraft: parsed.ready_to_draft !== false,
        extraSearches,
      }
    }
  } catch { /* fall through */ }

  return fallbackDeliberation(state, checkpoint)
}

function fallbackDeliberation(state, checkpoint) {
  if (checkpoint === 'start') {
    const raw = (state.queryForPlanning || state.query || '').toLowerCase().trim()
    // Identity / profile queries should use get_user_settings, not web search
    if (/\b(who am i|what('?s| is) my name|my (settings|profile|preferences))\b/i.test(raw)) {
      return {
        assessment: 'Fallback: user identity query → get_user_settings',
        tasks: [{
          toolId: 'get_user_settings',
          args: {},
          priority: 8,
        }],
      }
    }
    const fallbackQuery = sanitizeSearchQuery(raw)
    return {
      assessment: 'Fallback: default web search',
      tasks: [{
        toolId: 'web_search',
        args: { query: fallbackQuery },
        priority: 5,
      }],
    }
  }
  return { assessment: 'Fallback: proceed to draft', readyToDraft: true, extraSearches: [] }
}

// ── Scheduling helpers ─────────────────────────────────────────
// These wire dependency edges so the LLM doesn't have to reason about IDs.

/**
 * Schedule a draft node. It depends on all non-failed retrieval and summarize nodes
 * that exist at the time of scheduling (completed or still pending/active).
 */
function scheduleDraft(plan, args = {}) {
  const retrievalDeps = plan
    .getNodesByTool([...getRetrievalToolIds(), 'summarize'])
    .filter(n => n.status !== 'failed')
    .map(n => n.id)
  return plan.createTaskNode({ toolId: 'draft', args, priority: 7, deps: retrievalDeps })
}

/** Schedule a summarize node that depends on all non-failed retrieval nodes. */
function scheduleSummarize(plan) {
  const retrievalDeps = plan
    .getNodesByTool(getRetrievalToolIds())
    .filter(n => n.status !== 'failed')
    .map(n => n.id)
  return plan.createTaskNode({ toolId: 'summarize', args: {}, priority: 6, deps: retrievalDeps })
}

/** Schedule a reflect node that depends on the given draft node. */
function scheduleReflect(plan, draftId) {
  return plan.createTaskNode({ toolId: 'reflect', args: {}, priority: 8, deps: [draftId] })
}

/** Schedule the terminal finalize node that depends on the given reflect node. */
function scheduleFinalize(plan, reflectId) {
  return plan.createTaskNode({ toolId: 'finalize', args: {}, priority: 10, deps: [reflectId] })
}

// ── Task-specific executors ────────────────────────────────────

async function executeSummarize(task, state) {
  const { mode, gathered, query } = state
  const ctx = buildSystemPrompt(mode, gathered, '')
  const summary = await webllmComplete(
    [
      {
        role: 'system',
        content: `${ctx.systemPrompt}\n\nSummarize the above evidence for downstream reasoning. Return concise bullet points with [source] references.`,
      },
      { role: 'user', content: `Question: ${query.slice(0, 400)}` },
    ],
    { maxTokens: 280 },
  )
  return { success: true, summary, note: 'evidence summarized' }
}

async function executeDraft(task, state) {
  const { mode, gathered, goal, query, reflectionNotes, newMessages } = state
  const isRetry = Boolean(task.args?.isRetry)

  const context = buildSystemPrompt(mode, gathered, '')
  const memoryPrefix = buildMemoryPromptPrefix(state)
  // Strip any upstream system messages — we always prepend our own freshly-built one.
  const userAssistantMessages = (newMessages || []).filter(m => m?.role !== 'system')
  const fullMessages = [{ role: 'system', content: `${context.systemPrompt}\n\n${memoryPrefix}` }, ...userAssistantMessages]

  const baseInstruction = goal !== 'Standard answer'
    ? `STRICT FORMAT REQUIREMENT: ${goal}`
    : mode === 'research'
      ? 'Produce a structured deep-research answer: executive summary, key findings, evidence-backed analysis.'
      : 'Produce the best single final answer. Keep it concise and useful.'

  const promptContent = isRetry && reflectionNotes
    ? `Improve this draft based on these specific issues:\n${reflectionNotes}\n\nApply all improvements silently. Output only the improved draft.`
    : `${baseInstruction}\nDo not reveal internal reasoning.`

  const text = await webllmComplete(
    [...fullMessages, { role: 'user', content: promptContent }],
    { maxTokens: mode === 'research' ? 500 : 340 },
  )

  return { success: true, text: text || '', note: isRetry ? 'retry draft' : 'initial draft' }
}

async function executeReflect(task, state) {
  const { query, draft, goal, mode } = state
  if (!draft) {
    // Nothing to reflect on — auto-pass
    return { success: true, verdict: 'PASS', quality: 0.7, improvements: '', missingQueries: [], checklist: '' }
  }
  const result = await runReflection(query, draft, mode, goal)
  return { success: true, ...result }
}

async function executeFinalize(task, state, { callbacks, abortCtrl }) {
  const { mode, gathered, goal, draft, reflectionNotes, newMessages } = state

  const context = buildSystemPrompt(mode, gathered, '')
  const memoryPrefix = buildMemoryPromptPrefix(state)
  // Strip any upstream system messages — we always prepend our own freshly-built one.
  const userAssistantMessages = (newMessages || []).filter(m => m?.role !== 'system')
  const fullMessages = [{ role: 'system', content: `${context.systemPrompt}\n\n${memoryPrefix}` }, ...userAssistantMessages]

  const finalInstruction = goal !== 'Standard answer'
    ? `STRICT FORMAT REQUIREMENT: ${goal}`
    : mode === 'research'
      ? 'Produce a structured deep-research answer: executive summary, key findings, evidence-backed analysis, and clear next steps.'
      : 'Produce the best single final answer. Keep it concise and useful.'

  const checklist = reflectionNotes || 'Answer directly, be accurate, concise, and friendly.'

  const guidedMessages = [
    ...fullMessages,
    {
      role: 'user',
      content:
        `${finalInstruction}\n\n` +
        'Apply this quality checklist silently — never mention checklist items, reflection, or drafts in your output:\n' +
        `${checklist}\n\n` +
        (draft ? `Use this draft as a starting point (improve upon it):\n${draft.slice(0, 800)}\n\n` : '') +
        'CITATION RULES: NEVER fabricate citations, DOIs, paper titles, author names, or URLs. ' +
        'Only cite sources from the provided reference material using [1], [2], etc.\n\n' +
        'IMPORTANT: Wrap your final response inside <answer></answer> tags. Output nothing outside these tags.',
    },
  ]

  let streamBuffer = ''
  try {
    for await (const token of webllmStreamChat(guidedMessages, { signal: abortCtrl.signal })) {
      streamBuffer += token
      let display = streamBuffer
      const m = display.match(/<answer>([\s\S]*)/i)
      if (m) display = m[1]
      display = display.replace(/<\/answer>/i, '')
      callbacks.setStreamingContent?.(display)
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    const normalized = err instanceof Error
      ? err
      : new Error(typeof err === 'string' ? err : (err?.message ?? 'LLM streaming failed'))
    console.error('[AgentLoop] Finalize stream error:', normalized.message)
    throw normalized
  }

  let finalText = streamBuffer
  const match = finalText.match(/<answer>([\s\S]*?)<\/answer>/i)
  if (match) finalText = match[1].trim()
  else finalText = finalText.replace(/<\/?answer>/gi, '').trim()

  return { success: true, text: finalText, streamBuffer, sources: context.sources, note: 'finalized' }
}

// ── Side-effect handlers ───────────────────────────────────────

/**
 * Called after a task succeeds. Updates state and auto-schedules
 * downstream nodes based on task type.
 */
function handleTaskCompletion(task, result, state, plan, callbacks) {
  const { addRoadmapStep } = callbacks

  switch (task.toolId) {
    case 'summarize':
    case 'draft':
    case 'reflect':
    case 'finalize':
      break // handled below in their own case blocks
    default:
      // Any registered tool: merge results into gathered evidence
      if (Array.isArray(result.results)) state.gathered.push(...result.results)
      return // skip the rest of the switch
  }

  switch (task.toolId) {

    case 'summarize':
      if (result.summary) {
        state.gathered.push({
          type: 'knowledge_prompt',
          title: 'Research summary',
          url: '',
          text: `Research summary:\n${result.summary}`,
        })
      }
      break

    case 'draft':
      state.draft = result.text || ''
      // Auto-schedule reflection immediately after every draft
      if (!plan.hasActiveTool('reflect')) {
        const reflectNode = scheduleReflect(plan, task.id)
        addRoadmapStep?.({ id: reflectNode.id, label: 'Reflection pass', status: 'pending', note: '' })
      }
      break

    case 'reflect': {
      state.reflectionNotes = result.improvements || ''
      const { verdict, missingQueries = [], quality } = result
      const draftRetries = plan.getNodesByTool('draft').filter(n => n.args?.isRetry).length

      if (verdict === 'PASS' || draftRetries >= MAX_DRAFT_RETRIES) {
        // Done — schedule terminal finalize node
        const finalNode = scheduleFinalize(plan, task.id)
        addRoadmapStep?.({ id: finalNode.id, label: 'Final answer', status: 'pending', note: '' })

      } else if (verdict === 'RETRY') {
        // Re-draft with feedback (depends on this reflect so it runs after)
        const draftNode = plan.createTaskNode({
          toolId: 'draft',
          args: { isRetry: true },
          priority: 7,
          deps: [task.id],
        })
        addRoadmapStep?.({ id: draftNode.id, label: 'Improved draft', status: 'pending', note: '' })

      } else if (verdict === 'RESEARCH' && missingQueries.length > 0) {
        // Add fallback searches, then a draft that waits for them + the reflect
        const searchIds = missingQueries.slice(0, 2).map(q => {
          const node = plan.createTaskNode({
            toolId: 'web_search',
            args: { query: sanitizeSearchQuery(q) },
            priority: 6,
            deps: [],
          })
          addRoadmapStep?.({ id: node.id, label: `Fallback: "${q.slice(0, 40)}"`, status: 'pending', note: '' })
          return node.id
        })
        const draftNode = plan.createTaskNode({
          toolId: 'draft',
          args: { isRetry: true },
          priority: 7,
          deps: [task.id, ...searchIds], // wait for reflect AND the new searches
        })
        addRoadmapStep?.({ id: draftNode.id, label: 'Improved draft', status: 'pending', note: '' })

      } else {
        // Unknown verdict or empty missingQueries — force finalize
        const finalNode = scheduleFinalize(plan, task.id)
        addRoadmapStep?.({ id: finalNode.id, label: 'Final answer', status: 'pending', note: '' })
      }
      break
    }

    case 'finalize':
      // Terminal — nothing more to schedule
      break
  }
}

/**
 * Called after a task fails. Pushes to failure log and schedules
 * a single rewrite-retry for retrieval tools (if budget allows).
 */
function handleTaskFailure(task, errorMsg, state, plan) {
  state.failures.push({ tool: task.toolId, query: task.args?.query || '', error: errorMsg })
  state.stepLog.push({ action: `${task.toolId} (failed)`, note: errorMsg })

  const isRetrievable = isRetryable(task.toolId)
  const alreadyRetried = Boolean(task.args?._isRetry)

  if (isRetrievable && !alreadyRetried && state.stepCount < MAX_STEPS - 2) {
    // Queue an async rewrite for the next loop iteration
    state._pendingRetries = state._pendingRetries || []
    state._pendingRetries.push({ originalTask: task, error: errorMsg })
  }
}

// ── Status label helper ────────────────────────────────────────

function taskStatusLabel(task) {
  // Internal agent tasks have fixed labels
  switch (task.toolId) {
    case 'summarize': return 'Summarizing evidence...'
    case 'draft': return task.args?.isRetry ? 'Improving draft...' : 'Drafting answer...'
    case 'reflect': return 'Evaluating draft...'
    case 'finalize': return 'Composing final answer...'
  }
  // Registered tools: use manifest-provided statusLabel
  return getToolStatusLabel(task.toolId, task.args || {})
}

// ── Main agent loop ────────────────────────────────────────────

/**
 * Run the deliberation-based agent loop.
 *
 * @param {object} opts
 * @param {string}           opts.query
 * @param {'ask'|'research'} opts.mode
 * @param {Array}            opts.conversationHistory
 * @param {Array}            opts.newMessages
 * @param {string}           [opts.conversationSummary]
 * @param {Array}            [opts.shortTermContext]
 * @param {AbortController}  opts.abortCtrl
 * @param {object}           opts.callbacks
 * @param {object}           opts.scark
 * @returns {Promise<{ finalText, sources, reasoningPreview, streamBuffer }>}
 */
export async function runAgentLoop({
  query,
  mode,
  conversationHistory,
  newMessages,
  conversationSummary = '',
  shortTermContext = [],
  userNotes = '',
  abortCtrl,
  callbacks,
  scark,
}) {
  const {
    initializeRoadmap,
    addRoadmapStep,
    setRoadmapStep,
    setStatus,
    setStreamingContent,
    setStreamingReasoningPreview,
    throwIfAborted,
    awaitWithAbort,
  } = callbacks

  // ── Agent state ────────────────────────────────────────────
  const state = {
    query,
    queryForPlanning: buildContextAnchoredQuery(query, conversationHistory),
    mode,
    goal: 'Standard answer',
    conversationSummary: typeof conversationSummary === 'string' ? conversationSummary.trim() : '',
    shortTermContext: Array.isArray(shortTermContext) ? shortTermContext : [],
    conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
    userNotes: typeof userNotes === 'string' ? userNotes.trim() : '',
    newMessages,          // full conversation, passed to LLM executors
    gathered: [],         // accumulated evidence documents
    failures: [],         // { tool, query, error }
    draft: '',            // latest draft text
    reflectionNotes: '',  // latest reflection feedback
    stepCount: 0,
    pageCap: mode === 'research' ? 5 : 2,
    stepLog: [],          // { action, note } for reasoning preview
    _pendingRetries: [],  // tasks queued for async rewrite-retry
  }

  // ── Initialize ─────────────────────────────────────────────
  initializeRoadmap(mode)
  const plan = new TaskGraph()

  // ── Step 0: Formulate goal ─────────────────────────────────
  setRoadmapStep('plan', 'in_progress')
  setStatus('Formulating output goal...')
  try {
    state.goal = await formulateGoal(query)
    throwIfAborted(abortCtrl)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    state.goal = 'Standard answer'
  }
  state.stepLog.push({ action: 'Formulate Goal', note: state.goal })

  // ── Step 0b: Classify query track ─────────────────────────────
  setStatus('Classifying query...')
  let queryTrack = 'STANDARD'
  try {
    queryTrack = await classifyQuery(query, conversationHistory, mode)
    throwIfAborted(abortCtrl)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    queryTrack = 'STANDARD'
  }
  state.stepLog.push({ action: 'Classify', note: queryTrack })

  // DIRECT track: skip deliberation + retrieval entirely, finalize from context.
  if (queryTrack === 'DIRECT') {
    setRoadmapStep('plan', 'completed', 'Direct answer')
    setStatus('Composing answer...')
    const directTask = { id: 'direct_finalize', toolId: 'finalize', args: {} }
    try {
      const directResult = await executeFinalize(directTask, state, { callbacks, abortCtrl })
      return {
        finalText: directResult.text || '',
        sources: directResult.sources || [],
        reasoningPreview: buildReasoningPreview(mode, state.stepLog, 0, ''),
        streamBuffer: directResult.streamBuffer || '',
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      // Fall through to normal pipeline on error
      queryTrack = 'STANDARD'
    }
  }

  // Start KB fallback fetch in parallel — merged into gathered at the end
  const fallbackCtxPromise = awaitWithAbort(
    scark?.chat?.getContext?.({
      messages: newMessages,
      topK: mode === 'research' ? 8 : 5,
      mode: 'ask', // Force 'ask' mode so this NEVER triggers a background web search
    }),
    abortCtrl,
    mode === 'research' ? 20000 : 15000,
  ).catch(() => null)

  // ── Deliberation: START ────────────────────────────────────
  setStatus('Deliberating initial plan...')
  try {
    const decision = await deliberate(state, plan, 'start')
    throwIfAborted(abortCtrl)

    let tasks = decision.tasks.slice(0, mode === 'research' ? 4 : 2)

    // Ask mode: deduplicate to one web_search
    if (mode === 'ask') {
      let seenWeb = false
      tasks = tasks.filter(t => {
        if (t.toolId !== 'web_search') return true
        if (seenWeb) return false
        seenWeb = true
        return true
      })
    }

    for (const t of tasks) {
      const node = plan.createTaskNode({ toolId: t.toolId, args: t.args, priority: t.priority || 5 })
      const label = getToolRoadmapLabel(t.toolId, t.args || {})
      addRoadmapStep({ id: node.id, label, status: 'pending', note: '' })
    }

    if (decision.assessment) state.stepLog.push({ action: 'Deliberate (start)', note: decision.assessment })
    setRoadmapStep('plan', 'completed', `${plan.nodes.size} task(s) planned`)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    setRoadmapStep('plan', 'completed', 'Planning fallback')
  }

  // Safety: if research mode produced no retrieval tasks, force one
  if (plan.nodes.size === 0 && mode === 'research') {
    const planningQuery = state.queryForPlanning || query
    const kw = sanitizeSearchQuery(
      planningQuery
        .replace(/\b(write|generate|create|produce|give me|provide|explain|describe|summarize|use|cite|mention|include|make|an?|the|on|of|about|with|from|for|and|or|in|to|that|this|it|is|are|was|were|be|been|being)\b/gi, ' ')
        .replace(/\s{2,}/g, ' ').trim(),
    ) || sanitizeSearchQuery(planningQuery)
    const node = plan.createTaskNode({ toolId: 'web_search', args: { query: kw }, priority: 5 })
    addRoadmapStep({ id: node.id, label: `Search: "${kw.slice(0, 50)}"`, status: 'pending', note: '' })
    state.stepLog.push({ action: 'Deliberate (start)', note: `forced fallback search: "${kw}"` })
  }

  // ── Main execution loop ────────────────────────────────────
  let postRetrieveDeliberated = false
  let finalResult = null

  while (state.stepCount < MAX_STEPS) {
    throwIfAborted(abortCtrl)

    // Drain any pending rewrite-retries before looking for executable tasks
    if (state._pendingRetries.length > 0) {
      const retry = state._pendingRetries.shift()
      try {
        setStatus('Rewriting failed query...')
        const rewritten = await rewriteFailedQuery(retry.originalTask.args?.query || query, retry.error)
        throwIfAborted(abortCtrl)
        const retryNode = plan.createTaskNode({
          toolId: retry.originalTask.toolId,
          args: { query: rewritten, _isRetry: true },
          priority: (retry.originalTask.priority || 5) - 1,
          deps: [],
        })
        addRoadmapStep({ id: retryNode.id, label: `Retry: "${rewritten.slice(0, 40)}"`, status: 'pending', note: '' })
        state.stepLog.push({ action: 'Rewrite', note: `"${retry.originalTask.args?.query?.slice(0, 30)}" → "${rewritten}"` })
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        // Rewrite failed — skip retry
      }
      continue
    }

    // Find the highest-priority ready task
    const executable = plan.getExecutableNodes()

    if (executable.length === 0) {
      // ── POST-RETRIEVE deliberation checkpoint ───────────
      // Triggered when: plan is exhausted, no draft or finalize is scheduled yet
      const hasPendingOrActive = plan.allNodes().some(
        n => n.status === 'pending' || n.status === 'active',
      )

      if (hasPendingOrActive) {
        // Tasks still exist but none are currently executable — deps not met.
        // In sequential execution this shouldn't happen, but guard against it.
        break
      }

      if (!postRetrieveDeliberated
        && !plan.hasActiveTool('draft')
        && !plan.hasActiveTool('finalize')) {
        postRetrieveDeliberated = true
        setStatus('Deliberating next phase...')
        setStreamingReasoningPreview(buildReasoningPreview(mode, state.stepLog, state.gathered.length, ''))

        try {
          const decision = await deliberate(state, plan, 'post_retrieve')
          throwIfAborted(abortCtrl)
          state.stepLog.push({ action: 'Deliberate (post_retrieve)', note: decision.assessment })

          // Schedule any extra searches the LLM requested
          for (const t of (decision.extraSearches || [])) {
            if (!plan.getNodesByTool('web_search').some(n => n.args?.query === t.args?.query)) {
              const node = plan.createTaskNode({ toolId: t.toolId, args: t.args, priority: t.priority || 4 })
              addRoadmapStep({ id: node.id, label: `Extra search: "${(t.args.query || '').slice(0, 40)}"`, status: 'pending', note: '' })
            }
          }

          // In research mode, summarize before drafting
          if (mode === 'research' && state.gathered.length > 0 && !plan.hasActiveTool('summarize')) {
            const sumNode = scheduleSummarize(plan)
            addRoadmapStep({ id: sumNode.id, label: 'Summarize evidence', status: 'pending', note: '' })
          }

          // Schedule draft (depends on any outstanding retrievals + summarize)
          if (decision.readyToDraft !== false && !plan.hasActiveTool('draft')) {
            const draftNode = scheduleDraft(plan)
            addRoadmapStep({ id: draftNode.id, label: 'Draft answer', status: 'pending', note: '' })
          }
        } catch (err) {
          if (err?.name === 'AbortError') throw err
          // Deliberation failed — schedule draft unconditionally
          if (!plan.hasActiveTool('draft')) {
            const draftNode = scheduleDraft(plan)
            addRoadmapStep({ id: draftNode.id, label: 'Draft answer', status: 'pending', note: '' })
          }
        }
        continue // Re-enter loop with newly scheduled tasks
      }

      // Nothing left to do
      break
    }

    // ── Execute the top-priority task ──────────────────────
    const task = executable[0]
    plan.updateTaskNode(task.id, { status: 'active' })
    setRoadmapStep(task.id, 'in_progress')
    setStatus(taskStatusLabel(task))
    setStreamingReasoningPreview(
      buildReasoningPreview(mode, state.stepLog, state.gathered.length, state.reflectionNotes),
    )

    try {
      let result

      if (task.toolId === 'summarize') {
        result = await executeSummarize(task, state)
      } else if (task.toolId === 'draft') {
        result = await executeDraft(task, state)
      } else if (task.toolId === 'reflect') {
        result = await executeReflect(task, state)
      } else if (task.toolId === 'finalize') {
        result = await executeFinalize(task, state, { callbacks, abortCtrl })
        finalResult = result
      } else if (isRegisteredTool(task.toolId)) {
        const runRes = await runTool(task.toolId, { state, scark, awaitWithAbort, abortCtrl, recover: recoverTimedOutTask }, task.args)
        if (runRes?.success) {
          result = { success: true, results: runRes.result?.results || [], note: runRes.result?.note || '' }
        } else {
          result = { success: false, results: [], error: runRes?.error || `Unknown tool error: ${task.toolId}` }
        }
      } else {
        result = { success: false, error: `Unknown task: ${task.toolId}` }
      }

      throwIfAborted(abortCtrl)

      if (result.success) {
        plan.markCompleted(task.id, result)
        setRoadmapStep(task.id, 'completed', result.note || '')
        state.stepLog.push({ action: task.toolId, note: result.note || '' })
        handleTaskCompletion(task, result, state, plan, callbacks)
      } else {
        plan.markFailed(task.id, result.error || 'failed')
        setRoadmapStep(task.id, 'failed', result.error || 'failed')
        handleTaskFailure(task, result.error || 'failed', state, plan)
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      const msg = err instanceof Error ? err.message : String(err)
      plan.markFailed(task.id, msg)
      setRoadmapStep(task.id, 'failed', msg)
      handleTaskFailure(task, msg, state, plan)
    }

    state.stepCount++

    // Finalize is the terminal task — exit immediately after it completes
    if (task.toolId === 'finalize') break
  }

  // ── Merge parallel KB fallback context ────────────────────
  const fallbackCtx = await fallbackCtxPromise
  if (fallbackCtx?.success) {
    for (const s of (fallbackCtx.sources ?? [])) {
      if (!state.gathered.find(g => g.url === s.url)) {
        state.gathered.push({ type: 'knowledge', title: s.title, url: s.url, text: '' })
      }
    }
    if (fallbackCtx.systemPrompt && !state.gathered.find(g => g.type === 'knowledge_prompt')) {
      state.gathered.push({ type: 'knowledge_prompt', title: 'Knowledge context', url: '', text: fallbackCtx.systemPrompt })
    }
  }

  // ── Emergency fallback ─────────────────────────────────────
  // If the loop exited without a finalize (e.g. step cap hit), stream whatever we have.
  if (!finalResult) {
    setStatus('Composing final answer...')
    const emergencyTask = { id: 'emergency_finalize', toolId: 'finalize', args: {} }
    try {
      finalResult = await executeFinalize(emergencyTask, state, { callbacks, abortCtrl })
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      finalResult = {
        text: state.draft || 'I was unable to generate a complete response.',
        sources: [],
        streamBuffer: '',
      }
    }
  }

  return {
    finalText: finalResult.text || '',
    sources: finalResult.sources || buildSystemPrompt(mode, state.gathered, '').sources,
    reasoningPreview: buildReasoningPreview(mode, state.stepLog, state.gathered.length, state.reflectionNotes),
    streamBuffer: finalResult.streamBuffer || '',
  }
}