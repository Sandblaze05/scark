// Simple in-memory tool registry

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest required');
  if (!manifest.id || typeof manifest.id !== 'string') throw new Error('manifest.id required');
  if (!manifest.name || typeof manifest.name !== 'string') throw new Error('manifest.name required');
}

const registry = new Map();

export function registerTool(manifest, runner) {
  validateManifest(manifest);
  if (typeof runner !== 'function') throw new Error('runner must be a function');
  if (registry.has(manifest.id)) {
    throw new Error(`tool with id "${manifest.id}" already registered`);
  }
  registry.set(manifest.id, { manifest, runner });
  return manifest.id;
}

export function getTool(id) {
  const entry = registry.get(id);
  if (!entry) throw new Error(`tool not found: ${id}`);
  return entry;
}

export function listTools() {
  return Array.from(registry.values()).map(e => e.manifest);
}

// ── Registry helpers ─────────────────────────────────────────

/** Check whether a tool with the given id is registered. */
export function isRegisteredTool(id) {
  return registry.has(id);
}

/** Return the category of a registered tool ('retrieval' | 'utility' | 'unknown'). */
export function getToolCategory(id) {
  return registry.get(id)?.manifest?.category || 'unknown';
}

/** Return all registered tool IDs whose category is 'retrieval'. */
export function getRetrievalToolIds() {
  return Array.from(registry.values())
    .filter(e => e.manifest.category === 'retrieval')
    .map(e => e.manifest.id);
}

/** Return the status label for a running tool (shown in the UI). */
export function getToolStatusLabel(id, args = {}) {
  const m = registry.get(id)?.manifest;
  if (!m) return `Running ${id}...`;
  if (typeof m.statusLabel === 'function') return m.statusLabel(args);
  if (typeof m.statusLabel === 'string') return m.statusLabel;
  const q = (args.query || args.url || '').slice(0, 50);
  return q ? `${m.name}: "${q}"...` : `Running ${m.name}...`;
}

/** Return the roadmap step label for a tool (shown in the plan UI). */
export function getToolRoadmapLabel(id, args = {}) {
  const m = registry.get(id)?.manifest;
  if (!m) return id;
  if (typeof m.roadmapLabel === 'function') return m.roadmapLabel(args);
  if (typeof m.roadmapLabel === 'string') return m.roadmapLabel;
  const q = (args.query || args.url || '').slice(0, 50);
  return q ? `${m.name}: "${q}"` : m.name;
}

/** Return whether a tool supports rewrite-retry on failure. */
export function isRetryable(id) {
  const m = registry.get(id)?.manifest;
  if (!m) return false;
  return m.retryable === true;
}

// ── Shared utilities ───────────────────────────────────────────

// Simple sanitiser for search queries
function sanitizeSearchQuery(raw) {
  const cleaned = (raw || '')
    .replace(/\b(AND|OR|NOT)\b/gi, ' ')
    .replace(/\b\w+:/g, ' ')
    .replace(/[?*]+/g, '')
    .replace(/[()]/g, ' ')
    .replace(/['"]/g, ' ')
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

/**
 * Register default adapters that forward to the existing `scark` IPC.
 * Runner ctx should include: { state, scark, awaitWithAbort, abortCtrl }
 */
export function registerDefaultAdapters() {
  // web_search
  try {
    registerTool({
      id: 'web_search',
      name: 'Web Search',
      description: 'Search the web and return hits',
      category: 'retrieval',
      retryable: true,
      statusLabel: (args) => `Searching: "${(args.query || '').slice(0, 50)}"...`,
      roadmapLabel: (args) => `Search: "${(args.query || '').slice(0, 50)}"`,
    }, async (ctx = {}, args = {}) => {
      const scark = ctx.scark
      const mode = ctx.state?.mode || 'ask'
      const maxPages = mode === 'research' ? 5 : (ctx.state?.pageCap || 2)
      const timeout = mode === 'research' ? 130000 : 70000
      const cleanQuery = sanitizeSearchQuery(args.query || '')
      const awaitWithAbort = ctx.awaitWithAbort
      const requestId = `websearch:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`

      const call = scark?.query?.websearch ? scark.query.websearch(cleanQuery, maxPages, requestId) : Promise.resolve([])
      let raw
      try {
        raw = await (awaitWithAbort ? awaitWithAbort(call, ctx.abortCtrl, timeout) : call)
      } catch (err) {
        if (err?.name === 'TimeoutError' && ctx.recover) {
          const recovered = await ctx.recover(requestId, scark, ctx.abortCtrl)
          if (recovered) {
            raw = recovered
          } else {
            await scark?.query?.cancelTask?.(requestId).catch(() => null)
            throw err
          }
        } else {
          throw err
        }
      }
      const payload = Array.isArray(raw)
        ? { status: 'completed', reason: '', results: raw, meta: {} }
        : {
          status: raw?.status || 'completed',
          reason: raw?.reason || '',
          results: raw?.results || [],
          meta: raw?.meta || {},
        }

      if (payload.status === 'failed') {
        throw new Error(payload.reason || 'Web search failed')
      }

      const results = (payload.results ?? []).map(h => ({ type: 'web', title: h.title, url: h.url, text: h.text }))
      if (payload.status === 'busy') {
        const elapsed = payload.meta?.elapsedMs ? ` in ${Math.round(payload.meta.elapsedMs / 1000)}s` : ''
        return { results, note: `search skipped (crawler busy${elapsed})` }
      }

      const elapsed = payload.meta?.elapsedMs ? ` in ${Math.round(payload.meta.elapsedMs / 1000)}s` : ''
      const note = results.length > 0
        ? `${results.length} hit(s)${elapsed}`
        : `crawl completed, 0 cleaned hit(s)${elapsed}`
      return { results, note }
    })
  } catch (_) { }

  // read_url
  try {
    registerTool({
      id: 'read_url',
      name: 'Read URL',
      description: 'Fetch and read a specific URL',
      category: 'retrieval',
      retryable: true,
      statusLabel: (args) => `Reading: ${(args.url || args.query || '').slice(0, 50)}...`,
      roadmapLabel: (args) => `Read: "${(args.url || args.query || '').slice(0, 50)}"`,
    }, async (ctx = {}, args = {}) => {
      const scark = ctx.scark
      const timeout = ctx.state?.mode === 'research' ? 45000 : 30000
      const awaitWithAbort = ctx.awaitWithAbort
      const targetUrl = normalizeUrl(args.url || args.query)
      if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return { results: [], note: 'invalid_url' }
      }
      
      const requestId = `fetch:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
      const call = scark?.query?.fetchUrl ? scark.query.fetchUrl(targetUrl, requestId) : Promise.resolve(null)
      
      let page
      try {
        page = await (awaitWithAbort ? awaitWithAbort(call, ctx.abortCtrl, timeout) : call)
      } catch (err) {
        if (err?.name === 'TimeoutError' && ctx.recover) {
          const recovered = await ctx.recover(requestId, scark, ctx.abortCtrl)
          if (recovered) {
            page = recovered
          } else {
            await scark?.query?.cancelTask?.(requestId).catch(() => null)
            throw err
          }
        } else {
          throw err
        }
      }
      const results = []
      if (page?.text) results.push({ type: 'url', title: page.title || targetUrl, url: targetUrl, text: page.text })
      return { results, note: page?.text ? 'read' : 'empty' }
    })
  } catch (_) { }

  // knowledge_search
  try {
    registerTool({
      id: 'knowledge_search',
      name: 'Knowledge Search',
      description: 'Search local knowledge base (Chroma/SQLite) for context',
      category: 'retrieval',
      retryable: true,
      statusLabel: (args) => `Searching KB: "${(args.query || '').slice(0, 50)}"...`,
      roadmapLabel: (args) => `Search KB: "${(args.query || '').slice(0, 50)}"`,
    }, async (ctx = {}, args = {}) => {
      const scark = ctx.scark
      const topK = ctx.state?.mode === 'research' ? 8 : 5
      const timeout = ctx.state?.mode === 'research' ? 20000 : 15000
      const awaitWithAbort = ctx.awaitWithAbort
      const requestId = `context:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`

      const call = scark?.chat?.getContext ? scark.chat.getContext({ messages: [{ role: 'user', content: args.query }], topK, mode: 'ask', requestId }) : Promise.resolve({ success: false })
      
      let kbCtx
      try {
        kbCtx = await (awaitWithAbort ? awaitWithAbort(call, ctx.abortCtrl, timeout) : call)
      } catch (err) {
        if (err?.name === 'TimeoutError' && ctx.recover) {
          const recovered = await ctx.recover(requestId, scark, ctx.abortCtrl)
          if (recovered && recovered.success !== false) {
            kbCtx = recovered
          } else {
            await scark?.query?.cancelTask?.(requestId).catch(() => null)
            kbCtx = { success: false }
          }
        } else {
          kbCtx = null
        }
      }
      const results = []
      if (kbCtx?.success) {
        for (const s of (kbCtx.sources ?? [])) {
          results.push({ type: 'knowledge', title: s.title, url: s.url, text: '' })
        }
        if (kbCtx.systemPrompt) results.push({ type: 'knowledge_prompt', title: 'Knowledge context', url: '', text: kbCtx.systemPrompt })
      }
      return { results, note: `${kbCtx?.sources?.length || 0} KB matches` }
    })
  } catch (_) { }

  // get_user_settings
  try {
    registerTool({
      id: 'get_user_settings',
      name: 'Get User Settings',
      description: 'Retrieve the user\'s profile and preferences to customize responses',
      category: 'utility',
      retryable: false,
      statusLabel: 'Loading user profile...',
      roadmapLabel: 'Load user profile',
    }, async (ctx = {}, args = {}) => {
      const scark = ctx.scark
      const call = scark?.profile?.get ? scark.profile.get() : Promise.resolve(null)
      const profile = await call
      if (!profile) return { results: [], note: 'No profile found' }

      // Format profile into readable text so buildSystemPrompt includes it
      const lines = Object.entries(profile)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${k}: ${v}`)
      const text = lines.length > 0
        ? `User profile:\n${lines.join('\n')}`
        : 'User profile: (empty)'

      const results = [{ type: 'settings', title: 'User Profile', url: '', text }]
      console.log(results);
      return { results, note: 'Profile loaded' }
    })
  } catch (_) { }
}

export async function runTool(id, ctx = {}, args = {}) {
  const entry = getTool(id);
  try {
    const result = await entry.runner(ctx, args);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}
