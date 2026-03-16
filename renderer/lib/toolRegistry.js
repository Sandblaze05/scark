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

export async function runTool(id, ctx = {}, args = {}) {
  const entry = getTool(id);
  try {
    const result = await entry.runner(ctx, args);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}

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

/**
 * Register default adapters that forward to the existing `scark` IPC.
 * Runner ctx should include: { state, scark, awaitWithAbort, abortCtrl }
 */
export function registerDefaultAdapters() {
  // web_search
  try {
    registerTool({ id: 'web_search', name: 'Web Search', description: 'Search the web and return hits' }, async (ctx = {}, args = {}) => {
      const scark = ctx.scark
      const mode = ctx.state?.mode || 'ask'
      const maxPages = mode === 'research' ? 5 : (ctx.state?.pageCap || 2)
      const timeout = mode === 'research' ? 130000 : 70000
      const cleanQuery = sanitizeSearchQuery(args.query || '')
      const awaitWithAbort = ctx.awaitWithAbort

      const call = scark?.query?.websearch ? scark.query.websearch(cleanQuery, maxPages) : Promise.resolve([])
      const raw = await (awaitWithAbort ? awaitWithAbort(call, ctx.abortCtrl, timeout) : call)
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
  } catch (_) {}

  // read_url
  try {
    registerTool({ id: 'read_url', name: 'Read URL', description: 'Fetch and read a specific URL' }, async (ctx = {}, args = {}) => {
      const scark = ctx.scark
      const timeout = ctx.state?.mode === 'research' ? 45000 : 30000
      const awaitWithAbort = ctx.awaitWithAbort
      const call = scark?.query?.fetchUrl ? scark.query.fetchUrl(args.url) : Promise.resolve(null)
      const page = await (awaitWithAbort ? awaitWithAbort(call, ctx.abortCtrl, timeout) : call)
      const results = []
      if (page?.text) results.push({ type: 'url', title: page.title || args.url, url: args.url, text: page.text })
      return { results, note: page?.text ? 'read' : 'empty' }
    })
  } catch (_) {}

  // knowledge_search
  try {
    registerTool({ id: 'knowledge_search', name: 'Knowledge Search', description: 'Search local knowledge base (Chroma/SQLite) for context' }, async (ctx = {}, args = {}) => {
      const scark = ctx.scark
      const topK = ctx.state?.mode === 'research' ? 8 : 5
      const timeout = ctx.state?.mode === 'research' ? 20000 : 15000
      const awaitWithAbort = ctx.awaitWithAbort
      const call = scark?.chat?.getContext ? scark.chat.getContext({ messages: [{ role: 'user', content: args.query }], topK, mode: 'ask' }) : Promise.resolve({ success: false })
      const kbCtx = await (awaitWithAbort ? awaitWithAbort(call, ctx.abortCtrl, timeout) : call).catch(() => null)
      const results = []
      if (kbCtx?.success) {
        for (const s of (kbCtx.sources ?? [])) {
          results.push({ type: 'knowledge', title: s.title, url: s.url, text: '' })
        }
        if (kbCtx.systemPrompt) results.push({ type: 'knowledge_prompt', title: 'Knowledge context', url: '', text: kbCtx.systemPrompt })
      }
      return { results, note: `${kbCtx?.sources?.length || 0} KB matches` }
    })
  } catch (_) {}
}
