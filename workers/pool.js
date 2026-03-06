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
            const { task, resolve, reject } = this.#queue.shift();
            this.#dispatch(worker, task, resolve, reject);
        }
    }

    #dispatch(worker, task, resolve, reject) {
        const taskId = randomUUID();

        const onMessage = (msg) => {
            if (msg.taskId !== taskId) return;
            cleanup();
            this.#idle.push(worker);
            this.#drain();
            if (msg.error) reject(new Error(msg.error));
            else resolve(msg.result);
        };

        const onError = (err) => {
            cleanup();
            reject(err);
        };

        const cleanup = () => {
            worker.off('message', onMessage);
            worker.off('error', onError);
        };

        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.postMessage({ taskId, ...task });
    }

    // ── Public API ────────────────────────────────────────

    /**
     * Submit a task to the pool.  Resolves when a worker finishes it.
     *
     * @param {{ type: string, data?: any }} task
     * @returns {Promise<any>}
     */
    exec(task) {
        return new Promise((resolve, reject) => {
            const worker = this.#idle.pop();
            if (worker) {
                this.#dispatch(worker, task, resolve, reject);
            } else {
                this.#queue.push({ task, resolve, reject });
            }
        });
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
