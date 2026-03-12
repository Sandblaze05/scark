/**
 * agentLoop.js — Dynamic decision-making agent controller
 *
 * Replaces the linear plan→execute→reason→answer pipeline with a looping
 * state machine that evaluates results after each step and dynamically
 * decides what to do next.
 *
 * Control flow:
 *   Build state → Classify intent → Execute action → Evaluate → Loop or Answer
 *
 * Features:
 *   - Confidence-gated output (won't answer until confidence is adequate)
 *   - Timeout recovery with automatic query rewriting
 *   - Reflection-based retry (1 retry max)
 *   - Hard step cap (MAX_STEPS) to prevent runaway loops
 */

import {
  complete as webllmComplete,
  streamChat as webllmStreamChat,
  planActions,
  formulateGoal,
} from './webllm.js'

// ── Constants ─────────────────────────────────────────────────
const MAX_STEPS  = 6
const CONFIDENCE = { LOW: 0.4, HIGH: 0.7 }

// ── Intent classification ────────────────────────────────────

/**
 * Ask the LLM to decide the next action given current agent state.
 *
 * Returns: { action: string, confidence: number, reason: string }
 */
async function classifyIntent(state) {
  const stateDescription = [
    `User query: "${state.query}"`,
    `Mode: ${state.mode}`,
    `Steps taken: ${state.stepCount}/${MAX_STEPS}`,
    `Evidence gathered: ${state.gathered.length} source(s)`,
    `Failed tools: ${state.failures.length}`,
    state.gathered.length > 0
      ? `Sources preview: ${state.gathered.slice(0, 3).map(g => g.title || g.url).join(', ')}`
      : 'No sources yet.',
    state.reflectionNotes ? `Previous reflection: ${state.reflectionNotes.slice(0, 200)}` : '',
  ].filter(Boolean).join('\n')

  const text = await webllmComplete([
    {
      role: 'system',
      content:
        'You are a decision-making agent. Given the current state, decide the single best next action.\n\n' +
        'Available actions:\n' +
        '  SEARCH      — web search for current/factual info (use when evidence is missing or insufficient)\n' +
        '  RETRIEVE    — search local knowledge base (use when the topic may have been researched before)\n' +
        '  RESPOND     — answer directly (use when confident enough or training knowledge suffices)\n' +
        '  REASON      — run a reasoning/reflection pass on gathered evidence before answering\n' +
        '  REWRITE     — rewrite the search query (use after a search failure/timeout)\n\n' +
        'Rules:\n' +
        '- If no evidence is gathered yet and the question needs facts, prefer SEARCH or RETRIEVE.\n' +
        '- If evidence is gathered but quality is uncertain, prefer REASON.\n' +
        '- If the question is trivial (math, greetings, common knowledge), prefer RESPOND immediately.\n' +
        '- If a previous search timed out or failed, prefer REWRITE then SEARCH.\n' +
        '- After 4+ steps, strongly prefer RESPOND to avoid loops.\n\n' +
        'Output EXACTLY 3 lines:\n' +
        'ACTION: <one of SEARCH, RETRIEVE, RESPOND, REASON, REWRITE>\n' +
        'CONFIDENCE: <0.0 to 1.0>\n' +
        'REASON: <short explanation>\n',
    },
    { role: 'user', content: stateDescription },
  ], { maxTokens: 60 })

  return parseIntentResponse(text, state)
}

/**
 * Parse the 3-line intent response. Falls back to heuristics on parse failure.
 */
function parseIntentResponse(text, state) {
  const lines = (text || '').trim().split('\n')
  let action = 'RESPOND'
  let confidence = 0.5
  let reason = ''

  for (const line of lines) {
    const actionMatch = line.match(/^ACTION:\s*(\w+)/i)
    if (actionMatch) action = actionMatch[1].toUpperCase()

    const confMatch = line.match(/^CONFIDENCE:\s*([\d.]+)/i)
    if (confMatch) confidence = Math.min(1, Math.max(0, parseFloat(confMatch[1])))

    const reasonMatch = line.match(/^REASON:\s*(.+)/i)
    if (reasonMatch) reason = reasonMatch[1].trim()
  }

  // Validate action
  const valid = ['SEARCH', 'RETRIEVE', 'RESPOND', 'REASON', 'REWRITE']
  if (!valid.includes(action)) action = 'RESPOND'

  // Safety: force RESPOND after many steps
  if (state.stepCount >= MAX_STEPS - 1) action = 'RESPOND'

  return { action, confidence, reason }
}

// ── Query rewriting on failure ───────────────────────────────

/**
 * Rewrite a failed query into something shorter and more keyword-focused.
 */
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
        '- Do NOT use boolean operators (AND, OR, NOT), quotes, or any advanced search syntax\n' +
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

// ── Query sanitizer ──────────────────────────────────────────

/**
 * Strip boolean operators, wildcards, nested quotes, and other advanced
 * syntax that LLMs sometimes generate but search engines can't handle.
 * Returns a simple keyword string suitable for DuckDuckGo/Google/Bing.
 */
function sanitizeSearchQuery(raw) {
  const cleaned = (raw || '')
    // Remove boolean operators (AND, OR, NOT) as standalone words
    .replace(/\b(AND|OR|NOT)\b/g, ' ')
    // Remove field-specific syntax like title: site: etc.
    .replace(/\b\w+:/g, ' ')
    // Remove wildcards
    .replace(/[?*]+/g, '')
    // Remove parentheses
    .replace(/[()]/g, ' ')
    // Remove all double-quotes (keeps the words inside)
    .replace(/"/g, ' ')
    // Remove minus-prefix exclusions (-word)
    .replace(/-\s*\S+/g, ' ')
    // Collapse multiple spaces
    .replace(/\s{2,}/g, ' ')
    .trim()
    // If sanitization left us with nothing, fall back to first 6 words of raw
    || raw.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 6).join(' ')

  // Cap at 10 words — long queries slow down search engines and seed searches
  const words = cleaned.split(/\s+/)
  return words.length > 10 ? words.slice(0, 10).join(' ') : cleaned
}

// ── Tool execution ───────────────────────────────────────────

/**
 * Execute a single tool call. Returns { success, results[], error? }
 */
async function executeTool(toolName, args, state, scark, awaitWithAbort, abortCtrl) {
  const mode = state.mode
  const results = []

  try {
    // NOTE: web_search triggers the full pipeline (seed → crawl → clean →
    // chunk → embed → store) which routinely takes 30-60s. Timeouts must
    // be generous enough for this end-to-end pipeline to complete.
    if (toolName === 'web_search' && scark?.query?.websearch) {
      const maxPages = mode === 'research' ? 5 : (state.pageCap || 2)
      const timeout = mode === 'research' ? 75000 : 55000
      const cleanQuery = sanitizeSearchQuery(args.query)
      const hits = await awaitWithAbort(
        scark.query.websearch(cleanQuery, maxPages),
        abortCtrl,
        timeout,
      )
      for (const h of (hits ?? [])) {
        results.push({ type: 'web', title: h.title, url: h.url, text: h.text })
      }
      return { success: true, results, note: `${results.length} hit(s)` }
    }

    if (toolName === 'read_url' && scark?.query?.fetchUrl) {
      const timeout = mode === 'research' ? 45000 : 30000
      const page = await awaitWithAbort(scark.query.fetchUrl(args.url), abortCtrl, timeout)
      if (page?.text) {
        results.push({ type: 'url', title: page.title || args.url, url: args.url, text: page.text })
      }
      return { success: true, results, note: page?.text ? 'read' : 'empty' }
    }

    if (toolName === 'knowledge_search' && scark?.chat?.getContext) {
      const topK = mode === 'research' ? 8 : 5
      const timeout = mode === 'research' ? 20000 : 15000
      const kbCtx = await awaitWithAbort(
        scark.chat.getContext({
          messages: [{ role: 'user', content: args.query }],
          topK,
          mode: 'ask',
        }),
        abortCtrl,
        timeout,
      ).catch(() => null)

      if (kbCtx?.success) {
        for (const s of (kbCtx.sources ?? [])) {
          results.push({ type: 'knowledge', title: s.title, url: s.url, text: '' })
        }
        if (kbCtx.systemPrompt) {
          results.push({ type: 'knowledge_prompt', title: 'Knowledge context', url: '', text: kbCtx.systemPrompt })
        }
        return { success: true, results, note: `${kbCtx.sources?.length || 0} KB matches` }
      }
      return { success: true, results, note: '0 KB matches' }
    }

    return { success: false, results: [], error: `Unknown tool: ${toolName}` }
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    return {
      success: false,
      results: [],
      error: err?.name === 'TimeoutError' ? 'Timed out' : (err?.message || 'Error'),
    }
  }
}

// ── System prompt builder ────────────────────────────────────

function buildSystemPrompt(mode, docs, fallbackPrompt) {
  const knowledgePrompt = docs.find(d => d.type === 'knowledge_prompt')?.text
  const docItems = docs.filter(d => d.type !== 'knowledge_prompt' && d.text)

  // Llama-3.2-3B has a ~4096 token context limit by default in WebLLM to save VRAM.
  // trimMessages() in webllm.js enforces a 3200-token (~12800 char) total prompt budget.
  // The system prompt here is ONLY the reference material — conversation history,
  // draft instructions, and the guided user message also share that 3200-token space.
  // Reserve ~1600 tokens for conversation + instructions, leaving ~1600 for context.
  const charBudget = mode === 'research' ? 6400 : 4800
  let used = 0
  let contextText = ''
  const usedDocs = []

  for (const d of docItems) {
    // Determine how much space is left for this document
    const remainingBudget = charBudget - used;
    if (remainingBudget <= 0) break; // Budget exhausted
    
    // We reserve space for the formatting: `[X] (Date: ...)\n\n\n` (~100 chars)
    const reserveChars = 100;
    const maxDocLength = Math.max(0, remainingBudget - reserveChars);
    
    // If we have literally no room for even a tiny fraction of the doc, stop
    if (maxDocLength < 200 && usedDocs.length > 0) break;

    const ts = d.timestamp ? ` (Date: ${d.timestamp})` : ''
    
    // Slice only if strictly necessary
    const safeText = d.text.length > maxDocLength ? d.text.slice(0, maxDocLength) + '\n...[Text truncated to fit context window]' : d.text;
    
    const entry = `[${usedDocs.length + 1}]${ts} ${d.title || d.url}\n${safeText}\n\n`
    
    used += entry.length
    usedDocs.push(d)
    contextText += entry
  }

  const basePrompt = knowledgePrompt || fallbackPrompt || 'You are a helpful assistant.'
  const modeInstruction = mode === 'research'
    ? 'Use evidence from sources, synthesize across documents, and call out uncertainty briefly when sources conflict.'
    : 'Use evidence from sources when available and keep the answer direct.'

  const citationGuard =
    'CITATION RULES (CRITICAL):\n' +
    '- ONLY cite sources from the numbered Reference material above using [1], [2], etc.\n' +
    '- NEVER invent, fabricate, or hallucinate citations, DOIs, paper titles, author names, journal names, or URLs that are not explicitly present in the reference material.\n' +
    '- If you need to reference an academic paper, book, or URL that is NOT in the provided sources, explicitly state that you cannot verify the reference and suggest the user search for it.\n' +
    '- If the provided sources are insufficient to answer with citations, say so clearly rather than making up references.\n'

  // Include KB sources (chromaDB hits) even if their text field is empty,
  // since their content reached the prompt via the knowledge_prompt entry.
  const kbSources = docs
    .filter(d => d.type === 'knowledge' && d.url && !usedDocs.find(u => u.url === d.url))
    .map(d => ({ title: d.title, url: d.url }))

  return {
    systemPrompt: `${basePrompt}\n\n${modeInstruction}\n${citationGuard}\n${contextText ? `\nReference material:\n${contextText}` : ''}`,
    sources: [...usedDocs.map(d => ({ title: d.title, url: d.url })), ...kbSources],
    docDigest: usedDocs.map((d, i) => `[${i + 1}] ${d.title || d.url}`).join('\n'),
  }
}

// ── Reflection pass ──────────────────────────────────────────

async function runReflection(query, draftText, mode, goalConstraint) {
  const text = await webllmComplete([
    {
      role: 'system',
      content:
        'You are a quality evaluator assessing a generated draft answer against the user\'s original query and any strict formatting goals.\n\n' +
        `Goal/Format Constraint: ${goalConstraint}\n\n` +
        'Return EXACTLY ONE of the following verdicts:\n' +
        'VERDICT: PASS (if the draft answers the query AND perfectly follows the format constraint)\n' +
        'VERDICT: RETRY (if the format or tone is wrong, but the necessary facts are present)\n' +
        'VERDICT: RESEARCH (if the draft lacks specific evidence, citations, or facts to answer the query or satisfy the constraint, OR if the draft contains fabricated/invented citations, paper titles, DOIs, author names, or URLs not from the provided sources)\n\n' +
        'Then output:\n' +
        'QUALITY: <0.0 to 1.0>\n' +
        'IMPROVEMENTS: <3-5 bullet points for improvement, or "none" if PASS>\n' +
        'MISSING_SOURCES: <If VERDICT is RESEARCH, write 1-2 search queries here separated by commas. Otherwise write "none".>\n',
    },
    {
      role: 'user',
      content: `Question: ${query}\n\nDraft answer:\n${draftText}`,
    },
  ], { maxTokens: 200 })

  const lines = (text || '').split('\n')
  let verdict = 'PASS'
  let quality = 0.7
  let improvements = ''
  let missingQueries = []

  for (const line of lines) {
    const vm = line.match(/^VERDICT:\s*(\w+)/i)
    if (vm) {
      const v = vm[1].toUpperCase()
      if (v === 'RETRY' || v === 'RESEARCH') verdict = v
      else verdict = 'PASS'
    }

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

  // Extract bullet list for silent checklist
  const bullets = improvements
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l))
    .map(l => l.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 5)

  return { verdict, quality, improvements, missingQueries, checklist: bullets.join('\n') }
}

// ── Reasoning preview builder ────────────────────────────────

function buildReasoningPreview(mode, stepLog, sourceCount, reflectionNotes) {
  const modeLabel = mode === 'research' ? 'Deep Research' : 'Ask'
  const stepsText = stepLog.length
    ? stepLog.map((s, i) => `${i + 1}. ${s.action}${s.note ? ` → ${s.note}` : ''}`).join('\n')
    : '1. (direct answer)'

  const reflectionExcerpt = (reflectionNotes || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360)

  return [
    `Mode: ${modeLabel}`,
    '',
    'Agent steps:',
    stepsText,
    '',
    `Retrieved sources: ${sourceCount}`,
    'Pipeline: dynamic agent loop',
    reflectionExcerpt
      ? `Reflection: ${reflectionExcerpt}${reflectionNotes.length > 360 ? ' ...' : ''}`
      : 'Reflection: pending',
  ].join('\n')
}

// ── Main agent loop ─────────────────────────────────────────

/**
 * Run the dynamic agent loop.
 *
 * @param {object} opts
 * @param {string} opts.query           – the user's question
 * @param {'ask'|'research'} opts.mode  – current mode
 * @param {Array} opts.conversationHistory – previous messages (for follow-up handling)
 * @param {Array} opts.newMessages      – full message array including new user message
 * @param {AbortController} opts.abortCtrl
 * @param {object} opts.callbacks       – UI state setters from Chat.js
 * @param {object} opts.scark           – window.scark IPC bridge
 * @returns {Promise<{ finalText: string, sources: Array, reasoningPreview: string, roadmapSnapshot: any }>}
 */
export async function runAgentLoop({
  query,
  mode,
  conversationHistory,
  newMessages,
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

  // ── Agent state ──
  const state = {
    query,
    mode,
    gathered: [],        // collected evidence documents
    failures: [],        // { tool, query, error }
    stepCount: 0,
    pageCap: 2,
    reflectionNotes: '',
    confidence: 0,
    stepLog: [],         // { action, note } for reasoning preview
  }

  // ── Initialize roadmap ──
  initializeRoadmap(mode)

  // ── Step 0: Formulate Goal ──
  setRoadmapStep('plan', 'in_progress')
  setStatus('Formulating output goal...')
  
  try {
    const goal = await formulateGoal(query)
    throwIfAborted(abortCtrl)
    state.goal = goal
    state.stepLog.push({ action: 'Formulate Goal', note: goal })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    state.goal = 'Standard answer'
    state.stepLog.push({ action: 'Formulate Goal', note: 'fallback (Standard answer)' })
  }

  // ── Step 1: Use planActions for initial tool plan (fast probe) ──
  setStatus('Planning actions...')

  let initialActions = []
  try {
    const { actions, pageCap } = await planActions(query, mode, conversationHistory)
    initialActions = actions
    state.pageCap = pageCap || 2
    throwIfAborted(abortCtrl)

    const maxActions = mode === 'research' ? 6 : 3
    initialActions = actions.slice(0, maxActions)

    // In ask mode, limit to first web_search
    if (mode === 'ask') {
      let seenWeb = false
      initialActions = initialActions.filter(a => {
        if (a.tool !== 'web_search') return true
        if (seenWeb) return false
        seenWeb = true
        return true
      })
    }

    const planNote = initialActions.length
      ? initialActions.map((a, i) => `${i + 1}. ${a.tool} → ${a.args?.query || a.args?.url || ''}`).join('\n')
      : 'No tools needed'
    setRoadmapStep('plan', 'completed', `${planNote}\npage cap: ${state.pageCap}`)

    state.stepLog.push({ action: 'Plan', note: `${initialActions.length} action(s)` })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    setRoadmapStep('plan', 'completed', 'Planning skipped (fallback)')
    state.stepLog.push({ action: 'Plan', note: 'fallback' })
  }

  // Also fetch KB context in parallel as fallback (always run this)
  const fallbackCtxPromise = awaitWithAbort(
    scark?.chat?.getContext?.({
      messages: newMessages,
      topK: mode === 'research' ? 8 : 5,
      mode,
    }),
    abortCtrl,
    mode === 'research' ? 20000 : 15000,
  ).catch(() => null)

  // ── Execute planned tools (or fallback if research mode) ──
  const retrieveStepId = 'retrieve'
  
  if (initialActions.length === 0 && mode === 'research') {
    // Safety fallback: if LLM failed to plan tools in research mode, force a search.
    // Extract only topic keywords from the user query (strip instructional phrasing)
    // to avoid passing a long prose prompt as a search query.
    const topicKeywords = sanitizeSearchQuery(
      query
        .replace(/\b(write|generate|create|produce|give me|provide|explain|describe|summarize|use|cite|mention|include|make|an?|the|on|of|about|with|from|for|and|or|in|to|that|this|it|is|are|was|were|be|been|being|at|by|as|into|through|during|before|after|between|out|against|above|below|up|down|off|over|under|again|further|then|once|here|there|when|where|why|how|all|both|each|few|more|most|other|some|such|only|own|same|so|than|too|very|can|will|just|should|could|would|may|might|must|shall|need|please|wherever|possible|reputable|publications|using|models?|approaches?|techniques?|methods?)\b/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
    ) || sanitizeSearchQuery(query)
    initialActions.push({
      tool: 'web_search',
      args: { query: topicKeywords }
    })
    state.stepLog.push({ action: 'Plan', note: `forced fallback search: "${topicKeywords}"` })
  }

  if (initialActions.length > 0) {
    const children = initialActions.map((a, i) => ({
      id: `retrieve_${i}`,
      label: `${a.tool === 'web_search' ? 'Search' : a.tool === 'read_url' ? 'Read' : 'Search KB'}: "${a.args.query || a.args.url || ''}"`,
      status: 'pending',
      note: '',
    }))
    addRoadmapStep({
      id: retrieveStepId,
      label: 'Retrieve evidence',
      status: 'in_progress',
      children,
    })
    setStatus(mode === 'research' ? 'Retrieving many docs...' : `Retrieving docs (cap ${state.pageCap})...`)

    // Execute each planned action
    for (let i = 0; i < initialActions.length; i++) {
      const action = initialActions[i]
      throwIfAborted(abortCtrl)

      callbacks.updateChildRoadmapStep?.(retrieveStepId, `retrieve_${i}`, 'in_progress')

      const result = await executeTool(
        action.tool,
        action.args,
        state,
        scark,
        awaitWithAbort,
        abortCtrl,
      )

      if (result.success) {
        state.gathered.push(...result.results)
        callbacks.updateChildRoadmapStep?.(retrieveStepId, `retrieve_${i}`, 'completed', result.note)
        state.stepLog.push({ action: action.tool, note: result.note })
      } else {
        // Record failure for potential rewrite
        state.failures.push({
          tool: action.tool,
          query: action.args?.query || action.args?.url || '',
          error: result.error,
        })
        callbacks.updateChildRoadmapStep?.(retrieveStepId, `retrieve_${i}`, 'failed', result.error)
        state.stepLog.push({ action: `${action.tool} (failed)`, note: result.error })
      }
      state.stepCount++
    }
    setRoadmapStep(retrieveStepId, 'completed', `${state.gathered.length} source(s) gathered`)
  } else {
    // Ask mode + 0 actions planned
    addRoadmapStep({ id: retrieveStepId, label: 'Retrieve evidence', status: 'skipped', note: 'No tools needed' })
  }

  // Merge fallback KB context (happens in both Ask and Research mode)
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

  setStreamingReasoningPreview(buildReasoningPreview(mode, state.stepLog, state.gathered.length, ''))

  // ── Dynamic loop: evaluate and potentially re-search ──
  // Only enter the dynamic loop if there were failures to recover from
  // or if we're in research mode and want to gather more evidence.
  let dynamicStep = 0
  while (state.failures.length > 0 && state.stepCount < MAX_STEPS && dynamicStep < 3) {
    dynamicStep++
    throwIfAborted(abortCtrl)

    const failure = state.failures.shift()

    // Rewrite the failed query
    const rewriteStepId = `rewrite_${dynamicStep}`
    addRoadmapStep({ id: rewriteStepId, label: `Rewrite: "${failure.query.slice(0, 40)}..."`, status: 'in_progress', note: '' })
    setStatus(`Rewriting failed query...`)

    const rewritten = await rewriteFailedQuery(failure.query, failure.error)
    throwIfAborted(abortCtrl)

    setRoadmapStep(rewriteStepId, 'completed', `→ "${rewritten}"`)
    state.stepLog.push({ action: 'Rewrite', note: `"${failure.query.slice(0, 30)}" → "${rewritten}"` })

    // Re-execute with rewritten query
    const retryStepId = `retry_${dynamicStep}`
    addRoadmapStep({ id: retryStepId, label: `Retry: "${rewritten.slice(0, 40)}"`, status: 'in_progress', note: '' })
    setStatus(`Retrying search: "${rewritten}"...`)

    const result = await executeTool(
      failure.tool,
      { query: rewritten, url: rewritten },
      state,
      scark,
      awaitWithAbort,
      abortCtrl,
    )

    if (result.success && result.results.length > 0) {
      state.gathered.push(...result.results)
      setRoadmapStep(retryStepId, 'completed', result.note)
      state.stepLog.push({ action: `${failure.tool} (retry)`, note: result.note })
    } else {
      setRoadmapStep(retryStepId, 'failed', result.error || 'no results')
      state.stepLog.push({ action: `${failure.tool} (retry failed)`, note: result.error || 'no results' })
    }
    state.stepCount++

    setStreamingReasoningPreview(buildReasoningPreview(mode, state.stepLog, state.gathered.length, ''))
  }

  // ── Research mode: summarize evidence ──
  if (mode === 'research' && state.gathered.length > 0) {
    addRoadmapStep({ id: 'summarize', label: 'Summarize docs', status: 'in_progress', note: '' })
    setStatus('Summarizing gathered docs...')

    try {
      const builtCtx = buildSystemPrompt(mode, state.gathered, '')
      const summary = await webllmComplete([
        {
          role: 'system',
          content: `${builtCtx.systemPrompt}\n\nSummarize the above evidence for downstream reasoning. Return concise bullet points with [source] references when possible.`,
        },
        {
          role: 'user',
          content: `Question: ${query.slice(0, 400)}`,
        },
      ], { maxTokens: 280 })
      throwIfAborted(abortCtrl)

      // Inject summary into gathered as a special doc
      state.gathered.push({
        type: 'knowledge_prompt',
        title: 'Research summary',
        url: '',
        text: `Research summary:\n${summary}`,
      })
      setRoadmapStep('summarize', 'completed', 'Evidence summary prepared')
      state.stepLog.push({ action: 'Summarize', note: 'done' })
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      setRoadmapStep('summarize', 'failed', err?.message || 'Error')
    }
  }

  // ── Goal-Driven Draft & Reflect Loop ──
  let draftText = ''
  let context = { systemPrompt: '', sources: [], docDigest: '' }
  let reflectionResult = { verdict: 'PASS', quality: 0.7, checklist: '', improvements: '', missingQueries: [] }
  let finalInstruction = mode === 'research'
    ? 'Produce a structured deep-research answer: executive summary, key findings, evidence-backed analysis, and clear next steps.'
    : 'Produce the best single final answer. Keep it concise and useful.'
  
  if (state.goal !== 'Standard answer') {
    finalInstruction = `STRICT FORMAT REQUIREMENT: ${state.goal}`
  }

  let draftLoopCount = 0
  const MAX_DRAFT_LOOPS = 3 // Prevent infinite draft/research loops
  let silentChecklist = 'Answer directly, be accurate, concise, and friendly.'

  while (draftLoopCount < MAX_DRAFT_LOOPS) {
    draftLoopCount++
    const isRetry = draftLoopCount > 1
    const draftStepId = `draft_${draftLoopCount}`
    
    // ── Draft answer ──
    addRoadmapStep({ id: draftStepId, label: isRetry ? 'Improved draft' : 'Draft answer', status: 'in_progress', note: '' })
    setStatus(isRetry ? 'Improving answer based on feedback...' : 'Drafting answer...')

    context = buildSystemPrompt(mode, state.gathered, '')
    const fullMessages = [{ role: 'system', content: context.systemPrompt }, ...newMessages]

    try {
      const promptContent = isRetry && state.reflectionNotes
        ? `Improve this answer based on these specific issues:\n${silentChecklist || state.reflectionNotes}\n\nApply improvements silently. Output the improved draft only.`
        : `${finalInstruction}\nDo not reveal internal reasoning.`

      draftText = await webllmComplete([
        ...fullMessages,
        { role: 'user', content: promptContent },
      ], { maxTokens: mode === 'research' ? 500 : 340 })
      
      throwIfAborted(abortCtrl)
      setRoadmapStep(draftStepId, 'completed', isRetry ? 'Draft improved' : 'Draft generated')
      state.stepLog.push({ action: isRetry ? 'Improved draft' : 'Draft', note: isRetry ? 'applied feedback' : 'generated' })
      state.stepCount++
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      setRoadmapStep(draftStepId, 'failed', err?.message || 'Error')
      break // Break loop on severe error
    }

    // ── Reflection pass ──
    reflectionResult = { verdict: 'PASS', quality: 0.7, checklist: '', improvements: '', missingQueries: [] }
    const reflectStepId = `reflect_${draftLoopCount}`
    addRoadmapStep({ id: reflectStepId, label: 'Reflection pass', status: 'in_progress', note: '' })
    setStatus('Evaluating draft against goal...')

    try {
      reflectionResult = await runReflection(query, draftText, mode, state.goal)
      throwIfAborted(abortCtrl)

      state.reflectionNotes = reflectionResult.improvements
      silentChecklist = reflectionResult.checklist
      
      let note = 'Quality approved'
      if (reflectionResult.verdict === 'RETRY') note = 'Retry recommended (formatting)'
      else if (reflectionResult.verdict === 'RESEARCH') note = 'Missing evidence detected'
      
      setRoadmapStep(reflectStepId, 'completed', note)
      state.stepLog.push({ action: 'Reflect', note: `${reflectionResult.verdict} (${reflectionResult.quality.toFixed(2)})` })
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      setRoadmapStep(reflectStepId, 'completed', 'Reflection skipped')
      break // Skip retry logic if reflection fails
    }

    setStreamingReasoningPreview(buildReasoningPreview(mode, state.stepLog, context.sources.length, state.reflectionNotes))

    // ── Handle Verdicts ──
    if (reflectionResult.verdict === 'PASS') {
      break // Success! Move to final answer.
    } else if (reflectionResult.verdict === 'RETRY') {
      // Loop around and draft again using the `silentChecklist`
      continue 
    } else if (reflectionResult.verdict === 'RESEARCH' && reflectionResult.missingQueries.length > 0) {
      // Goal not met because evidence is missing. Search for the missing queries.
      const researchStepId = `research_retry_${draftLoopCount}`
      addRoadmapStep({ id: researchStepId, label: 'Missing Evidence Fallback', status: 'in_progress', note: '' })
      setStatus(`Searching missing info: ${reflectionResult.missingQueries[0]}...`)
      
      const newQuery = reflectionResult.missingQueries[0]
      state.stepLog.push({ action: 'Fallback Search', note: `querying: ${newQuery}` })
      
      const result = await executeTool(
        'web_search',
        { query: newQuery, url: newQuery },
        state,
        scark,
        awaitWithAbort,
        abortCtrl,
      )

      if (result.success && result.results.length > 0) {
        state.gathered.push(...result.results)
        setRoadmapStep(researchStepId, 'completed', result.note)
      } else {
        setRoadmapStep(researchStepId, 'failed', result.error || 'no results')
      }
      
      state.stepCount++
      // Loop around. The next context build will include this new evidence!
      continue
    } else {
      break // Unknown verdict or missing queries array, just move on
    }
  }

  // ── Final streamed answer ──
  const finalStep = 'final'
  addRoadmapStep({
    id: finalStep,
    label: mode === 'research' ? 'Expand answer' : 'Final answer',
    status: 'in_progress',
    note: '',
  })
  setStatus(mode === 'research' ? 'Expanding final answer...' : 'Composing final answer...')

  silentChecklist = reflectionResult.checklist || 'Answer directly, be accurate, concise, and friendly.'
  finalInstruction = mode === 'research'
    ? 'Produce a structured deep-research answer: executive summary, key findings, evidence-backed analysis, and clear next steps.'
    : 'Produce the best single final answer. Keep it concise and useful.'

  const finalContext = buildSystemPrompt(mode, state.gathered, '')
  const finalFullMessages = [{ role: 'system', content: finalContext.systemPrompt }, ...newMessages]

  const guidedMessages = [
    ...finalFullMessages,
    {
      role: 'user',
      content:
        `${finalInstruction}\n\n` +
        'Apply this internal quality checklist silently. Never mention checklist items, reflection, drafts, or internal reasoning in your output.\n' +
        `${silentChecklist}\n\n` +
        (draftText ? `Use this draft as a starting point (improve upon it):\n${draftText.slice(0, 800)}\n\n` : '') +
        'CITATION RULES: NEVER fabricate citations, DOIs, paper titles, author names, journal names, or URLs. Only cite sources from the provided reference material using [1], [2], etc. If a reference is not in your sources, say you cannot verify it.\n\n' +
        'IMPORTANT: You MUST wrap your final user-facing response inside <answer> and </answer> tags. Output nothing outside of these tags.',
    },
  ]

  let streamBuffer = ''
  try {
    for await (const token of webllmStreamChat(guidedMessages, { signal: abortCtrl.signal })) {
      streamBuffer += token

      // Strip tags for display
      let displayContent = streamBuffer
      const answerMatch = displayContent.match(/<answer>([\s\S]*)/i)
      if (answerMatch) displayContent = answerMatch[1]
      displayContent = displayContent.replace(/<\/answer>/i, '')

      setStreamingContent(displayContent)
    }
  } catch (err) {
    if (err?.name !== 'AbortError' && !abortCtrl.signal.aborted) {
      // Normalize non-Error throws (WebGPU/WASM can throw strings or objects)
      const normalized = err instanceof Error
        ? err
        : new Error(typeof err === 'string' ? err : (err?.message ?? String(err ?? 'LLM streaming failed')))
      console.error('[AgentLoop] Final stream error:', normalized.message)
      throw normalized
    }
  }

  // Extract final text from answer tags
  let finalText = streamBuffer
  if (finalText) {
    const match = finalText.match(/<answer>([\s\S]*?)<\/answer>/i)
    if (match) {
      finalText = match[1].trim()
    } else {
      finalText = finalText.replace(/<\/?answer>/gi, '').trim()
    }
  }

  setRoadmapStep(finalStep, 'completed', 'Response generated')

  return {
    finalText,
    sources: context.sources,
    reasoningPreview: buildReasoningPreview(mode, state.stepLog, context.sources.length, state.reflectionNotes),
    streamBuffer,
  }
}
