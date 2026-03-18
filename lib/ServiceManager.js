import logger from './logger.js';

class ServiceManager {
  constructor() {
    this.services = new Map();
    this.isShuttingDown = false;
  }

  registerService(name, {
    start,
    stop,
    check,
    dependencies = [],
    autoStart = true,
    startTimeoutMs = 30000,
    readyTimeoutMs = 15000,
    startRetries = 1,
    backoffBaseMs = 500,
  } = {}) {
    if (!name) throw new Error('service name required');
    if (this.services.has(name)) {
      throw new Error(`service already registered: ${name}`);
    }

    this.services.set(name, {
      start: start || (async () => {}),
      stop:  stop  || (async () => {}),
      check: check || null,
      dependencies: Array.isArray(dependencies) ? dependencies : [],
      autoStart,
      startTimeoutMs,
      startRetries,
      backoffBaseMs,
      readyTimeoutMs,
      running: false,
      starting: null,
      stopping: null,
      meta: {},
      startedAt: null,
    });
  }

  _ensureService(name) {
    const svc = this.services.get(name);
    if (!svc) throw new Error(`Unknown service: ${name}`);
    return svc;
  }

  _withTimeout(promise, timeoutMs, message) {
    if (!timeoutMs || timeoutMs <= 0) return promise;
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  async _waitUntilReady(name, svc) {
    if (typeof svc.check !== 'function') return;

    const deadline = Date.now() + Math.max(0, svc.readyTimeoutMs || 0);
    while (Date.now() < deadline) {
      try {
        const ok = await svc.check(svc.meta);
        if (ok) return;
      } catch {
        // keep polling until timeout
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    throw new Error(`Service ${name} failed readiness check within ${svc.readyTimeoutMs}ms`);
  }

  async startService(name, _stack = new Set()) {
    if (_stack.has(name)) {
      throw new Error(`Dependency cycle detected while starting ${name}`);
    }

    const svc = this._ensureService(name);
    if (svc.running) return svc.meta;
    if (svc.starting) return svc.starting;

    _stack.add(name);
    for (const depName of svc.dependencies) {
      await this.startService(depName, _stack);
    }
    _stack.delete(name);

    svc.starting = (async () => {
      let attempt = 0;
      const maxAttempts = Math.max(1, svc.startRetries || 1);
      const base = Math.max(100, svc.backoffBaseMs || 500);

      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          logger.info('servicemanager', `Starting ${name} (attempt ${attempt}/${maxAttempts})`);
          const meta = await this._withTimeout(
            svc.start(),
            svc.startTimeoutMs,
            `Service ${name} start timed out after ${svc.startTimeoutMs}ms`
          );

          svc.meta = meta || {};
          svc.running = Boolean(svc.meta && (svc.meta.launched || svc.meta.external));

          if (svc.running) {
            await this._waitUntilReady(name, svc);
            svc.startedAt = Date.now();
            logger.info('servicemanager', `Started ${name}`);
            return svc.meta;
          }

          // If not running (skipped because external or auto-start disabled), return
          logger.info('servicemanager', `Skipped ${name} (launched: ${Boolean(svc.meta?.launched)}, external: ${Boolean(svc.meta?.external)})`);
          return svc.meta;
        } catch (err) {
          logger.error('servicemanager', `Failed to start ${name} (attempt ${attempt}): ${err?.message || err}`);
          if (attempt >= maxAttempts) {
            throw err;
          }
          const waitMs = base * Math.pow(2, attempt - 1);
          logger.info('servicemanager', `Retrying ${name} in ${waitMs}ms`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        } finally {
          if (attempt >= maxAttempts) svc.starting = null;
        }
      }
    })();

    return svc.starting;
  }

  async stopService(name) {
    const svc = this._ensureService(name);
    if (!svc.running) return;
    if (svc.stopping) return svc.stopping;

    svc.stopping = (async () => {
      try {
        await svc.stop(svc.meta);
        svc.running = false;
        svc.meta = {};
        svc.startedAt = null;
        console.log(`[ServiceManager] Stopped ${name}`);
      } catch (err) {
        console.error(`[ServiceManager] Failed to stop ${name}:`, err);
        throw err;
      } finally {
        svc.stopping = null;
      }
    })();

    return svc.stopping;
  }

  async ensureServiceStarted(name) {
    const svc = this._ensureService(name);
    if (svc.running) return svc.meta;
    return this.startService(name);
  }

  async startAll({ include = null, onlyAutoStart = false } = {}) {
    const names = Array.from(this.services.keys()).filter((name) => {
      if (include && !include.includes(name)) return false;
      if (onlyAutoStart) return this.services.get(name).autoStart;
      return true;
    });

    const started = [];
    for (const name of names) {
      const meta = await this.startService(name);
      started.push({ name, meta });
    }
    return started;
  }

  async stopAll() {
    this.isShuttingDown = true;
    const names = Array.from(this.services.keys());
    // stop in reverse registration order to better match startup dependencies
    names.reverse();
    const results = [];

    for (const name of names) {
      try {
        await this.stopService(name);
        results.push({ name, status: 'stopped' });
      } catch (err) {
        results.push({ name, status: 'failed', error: err?.message || String(err) });
      }
    }

    this.isShuttingDown = false;
    return results;
  }

  getServiceStatus(name) {
    const svc = this._ensureService(name);
    return {
      name,
      running: svc.running,
      starting: Boolean(svc.starting),
      autoStart: svc.autoStart,
      dependencies: svc.dependencies,
      startedAt: svc.startedAt,
      meta: svc.meta,
    };
  }

  listServiceStatuses() {
    return Array.from(this.services.keys()).map((name) => this.getServiceStatus(name));
  }
}

const singleton = new ServiceManager();
export default singleton;
