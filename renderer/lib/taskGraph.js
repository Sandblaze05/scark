// Minimal in-memory TaskGraph implementation

function generateId() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
}

export class TaskGraph {
  constructor() {
    this.nodes = new Map();
  }

  createTaskNode(node) {
    const id = node.id || generateId();
    const now = new Date().toISOString();
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
    };
    this.nodes.set(id, base);
    return base;
  }

  updateTaskNode(id, patch) {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`task node not found: ${id}`);
    Object.assign(n, patch, { updatedAt: new Date().toISOString() });
    this.nodes.set(id, n);
    return n;
  }

  getNode(id) {
    return this.nodes.get(id) || null;
  }

  markCompleted(id, result) {
    const n = this.getNode(id);
    if (!n) throw new Error(`task node not found: ${id}`);
    n.status = 'completed';
    n.result = result || null;
    n.updatedAt = new Date().toISOString();
    this.nodes.set(id, n);
    return n;
  }

  markFailed(id, error) {
    const n = this.getNode(id);
    if (!n) throw new Error(`task node not found: ${id}`);
    n.status = 'failed';
    n.result = { error: (error && error.message) || String(error) };
    n.updatedAt = new Date().toISOString();
    this.nodes.set(id, n);
    return n;
  }

  getExecutableNodes() {
    const executable = [];
    for (const node of this.nodes.values()) {
      if (node.status !== 'pending') continue;
      const depsDone = node.deps.every(d => {
        const dep = this.nodes.get(d);
        return dep && dep.status === 'completed';
      });
      if (depsDone) executable.push(node);
    }
    // simple priority sort (higher priority first)
    executable.sort((a, b) => b.priority - a.priority);
    return executable;
  }

  getState() {
    const pending = [], active = [], completed = [], failed = [];
    for (const node of this.nodes.values()) {
      if (node.status === 'pending') pending.push(node);
      else if (node.status === 'active') active.push(node);
      else if (node.status === 'completed') completed.push(node);
      else if (node.status === 'failed') failed.push(node);
    }
    return { pending, active, completed, failed };
  }

  allNodes() {
    return Array.from(this.nodes.values());
  }
}
