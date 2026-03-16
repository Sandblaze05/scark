/**
 * Generic Worker Thread Pool
 *
 * Manages a fixed-size pool of Node.js worker threads, dispatching tasks
 * via message passing and returning results as Promises.
 *
 * Usage:
 *   const pool = new WorkerPool('./workers/my.worker.js', 4);
 *   const result = await pool.exec({ type: 'doStuff', data: { ... } });
 *   await pool.destroy();
 */

import { Worker } from 'worker_threads';
import { randomUUID } from 'crypto';
import os from 'os';

export class WorkerPool {
    #workerScript;
    #workers = [];
    #idle = [];
    #queue = [];
    #queueSeq = 0;
    #activeByRequestId = new Map();

    /**
     * @param {string|URL} workerScript – path to the worker .js file
     * @param {number}     [size]       – pool size (defaults to cpu count − 1, min 1)
     */
    constructor(workerScript, size = Math.max(1, os.cpus().length - 1)) {
        this.#workerScript = workerScript;
        for (let i = 0; i < size; i++) this.#spawn();
    }

    // ── Internal helpers ──────────────────────────────────

    #spawn() {
        const worker = new Worker(this.#workerScript);
        this.#workers.push(worker);
        this.#idle.push(worker);

        worker.on('error', (err) => {
            console.error(`[WorkerPool] Worker ${worker.threadId} error:`, err.message);
            this.#remove(worker);
            this.#spawn();          // auto-replace crashed worker
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                console.warn(`[WorkerPool] Worker ${worker.threadId} exited (code ${code})`);
            }
            this.#remove(worker);
        });
    }

    #remove(worker) {
        this.#workers = this.#workers.filter(w => w !== worker);
        this.#idle = this.#idle.filter(w => w !== worker);
    }

    #drain() {
        while (this.#idle.length > 0 && this.#queue.length > 0) {
            const worker = this.#idle.pop();
            const entry = this.#queue.shift();
            this.#dispatch(worker, entry);
        }
    }

    #enqueue(entry) {
        this.#queue.push(entry);
        // Higher priority first; FIFO among equal priorities.
        this.#queue.sort((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.seq - b.seq;
        });
    }

    #dispatch(worker, entry) {
        const { task, resolve, reject, requestId } = entry;
        const taskId = randomUUID();
        let settled = false;

        const onMessage = (msg) => {
            if (msg.taskId !== taskId) return;
            if (settled) return;
            settled = true;
            cleanup();
            this.#idle.push(worker);
            this.#drain();
            if (msg.error) reject(new Error(msg.error));
            else resolve(msg.result);
        };

        const onError = (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        };

        const cleanup = () => {
            worker.off('message', onMessage);
            worker.off('error', onError);
            if (requestId) this.#activeByRequestId.delete(requestId);
        };

        if (requestId) {
            this.#activeByRequestId.set(requestId, {
                worker,
                reject,
                cleanup,
                settle: () => { settled = true; },
            });
        }

        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.postMessage({ taskId, ...task });
    }

    // ── Public API ────────────────────────────────────────

    /**
     * Submit a task to the pool.  Resolves when a worker finishes it.
     *
     * @param {{ type: string, data?: any }} task
     * @param {{ priority?: number }} [options]
     * @returns {Promise<any>}
     */
    exec(task, options = {}) {
        return new Promise((resolve, reject) => {
            const entry = {
                task,
                resolve,
                reject,
                requestId: options.requestId,
                priority: Number.isFinite(options.priority) ? options.priority : 0,
                seq: this.#queueSeq++,
            };
            const worker = this.#idle.pop();
            if (worker) {
                this.#dispatch(worker, entry);
            } else {
                this.#enqueue(entry);
            }
        });
    }

    async cancel(requestId, reason = 'Task cancelled') {
        if (!requestId) return false;

        const queuedIndex = this.#queue.findIndex(entry => entry.requestId === requestId);
        if (queuedIndex >= 0) {
            const [queued] = this.#queue.splice(queuedIndex, 1);
            queued.reject(new Error(reason));
            return true;
        }

        const active = this.#activeByRequestId.get(requestId);
        if (!active) return false;

        active.settle();
        active.cleanup();
        this.#remove(active.worker);
        try {
            await active.worker.terminate();
        } catch {
            // Ignore termination failures; a replacement worker is still spawned below.
        }
        this.#spawn();
        active.reject(new Error(reason));
        this.#drain();
        return true;
    }

    /** Pool statistics snapshot */
    get stats() {
        return {
            total: this.#workers.length,
            idle: this.#idle.length,
            busy: this.#workers.length - this.#idle.length,
            queued: this.#queue.length,
        };
    }

    /** Terminate every worker and clear the queue */
    async destroy() {
        // Reject anything still queued
        for (const { reject } of this.#queue) {
            reject(new Error('WorkerPool destroyed'));
        }
        this.#queue = [];
        await Promise.all(this.#workers.map(w => w.terminate()));
        this.#workers = [];
        this.#idle = [];
    }
}
