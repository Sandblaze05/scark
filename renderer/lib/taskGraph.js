function generateId() {
  return Math.random().toString(36).slice(2, 9)
}

// ── TaskGraph ──────────────────────────────────────────────────

export class TaskGraph {
  constructor() {
    this.nodes = new Map()
  }

  createTaskNode(node) {
    const id = node.id || generateId()
    const now = new Date().toISOString()
    const base = {
      id,
      toolId: node.toolId,
      args: node.args || {},
      deps: Array.isArray(node.deps) ? node.deps.slice() : [],
      status: node.status || 'pending', // pending | active | completed | failed
      retries: node.retries || 0,
      result: node.result || null,
      createdAt: node.createdAt || now,
      updatedAt: now,
      priority: node.priority || 0,
    }
    this.nodes.set(id, base)
    return base
  }

  updateTaskNode(id, patch) {
    const n = this.nodes.get(id)
    if (!n) throw new Error(`task node not found: ${id}`)
    Object.assign(n, patch, { updatedAt: new Date().toISOString() })
    this.nodes.set(id, n)
    return n
  }

  getNode(id) {
    return this.nodes.get(id) || null
  }

  markCompleted(id, result) {
    const n = this.getNode(id)
    if (!n) throw new Error(`task node not found: ${id}`)
    n.status = 'completed'
    n.result = result || null
    n.updatedAt = new Date().toISOString()
    this.nodes.set(id, n)
    return n
  }

  markFailed(id, error) {
    const n = this.getNode(id)
    if (!n) throw new Error(`task node not found: ${id}`)
    n.status = 'failed'
    n.result = { error: (error && error.message) || String(error) }
    n.updatedAt = new Date().toISOString()
    this.nodes.set(id, n)
    return n
  }

  /** Pending nodes whose every dep is completed — sorted by priority descending. */
  getExecutableNodes() {
    const executable = []
    for (const node of this.nodes.values()) {
      if (node.status !== 'pending') continue
      const depsDone = node.deps.every(d => {
        const dep = this.nodes.get(d)
        return dep && dep.status === 'completed'
      })
      if (depsDone) executable.push(node)
    }
    return executable.sort((a, b) => b.priority - a.priority)
  }

  getState() {
    const pending = [], active = [], completed = [], failed = []
    for (const node of this.nodes.values()) {
      if (node.status === 'pending') pending.push(node)
      else if (node.status === 'active') active.push(node)
      else if (node.status === 'completed') completed.push(node)
      else if (node.status === 'failed') failed.push(node)
    }
    return { pending, active, completed, failed }
  }

  allNodes() {
    return Array.from(this.nodes.values())
  }

  // ── Extended methods ───────────────────────────────────────

  /** True if any node with this toolId is pending or active. */
  hasActiveTool(toolId) {
    return [...this.nodes.values()].some(
      n => n.toolId === toolId && (n.status === 'pending' || n.status === 'active'),
    )
  }

  /** All nodes matching a given toolId (or array of toolIds). */
  getNodesByTool(toolId) {
    const ids = Array.isArray(toolId) ? new Set(toolId) : new Set([toolId])
    return [...this.nodes.values()].filter(n => ids.has(n.toolId))
  }

  /** True when every node has reached a terminal status (completed or failed). */
  isExhausted() {
    if (this.nodes.size === 0) return true
    return [...this.nodes.values()].every(
      n => n.status === 'completed' || n.status === 'failed',
    )
  }

  /** Collect the result objects from all completed dependency nodes. */
  collectDepResults(deps) {
    return deps
      .map(id => this.nodes.get(id))
      .filter(n => n?.status === 'completed' && n.result != null)
      .map(n => n.result)
  }

  /**
   * Compact summary for LLM deliberation prompts.
   * Keeps only the fields the LLM needs to reason about.
   */
  getSummary() {
    const st = this.getState()
    return {
      completed: st.completed.map(n => ({ id: n.id, tool: n.toolId, note: n.result?.note || '' })),
      failed:    st.failed.map(n =>    ({ id: n.id, tool: n.toolId, error: n.result?.error || '' })),
      pending:   st.pending.map(n =>   ({ id: n.id, tool: n.toolId })),
    }
  }
}