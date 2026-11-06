/**
 * lib/react/pool.mjs — the worker threads that compile React files (worker.mjs), started on first
 * need. One file side per task. A task that takes longer than the timeout (10 s) ends its worker,
 * which is replaced, and answers `analysis-timeout`; a worker that dies answers `compiler-error`
 * for its task. Either way the run goes on. Each worker has at most 512 MB of old-generation heap.
 */
import { Worker } from 'node:worker_threads';

/** @import { CompileResult } from '../../types/react.js' */

/**
 * @typedef {{ path: string, text: string, parser: string[] }} CompileTask
 * @typedef {{ id: number, task: CompileTask, done: (r: CompileResult) => void }} Job
 * @typedef {{ worker: Worker, job: Job | null, timer: NodeJS.Timeout | null }} Slot
 */

const WORKER = new URL('./worker.mjs', import.meta.url);

/**
 * A pool of at most `size` workers.
 * @param {{ size: number, babel: string, compiler: string, cwd: string, options: { compilationMode: string, target: string, environment: Record<string, unknown>, lint: boolean }, timeoutMs?: number }} o
 */
export function createPool({ size, babel, compiler, cwd, options, timeoutMs = 10_000 }) {
  /** @type {Slot[]} */
  const slots = [];
  /** @type {Job[]} */
  const queue = [];
  let next = 0;
  let started = 0;
  let closed = false;

  /** @param {Slot} slot */
  const finish = (slot, /** @type {CompileResult} */ result) => {
    const job = slot.job;
    if (slot.timer) clearTimeout(slot.timer);
    slot.job = null;
    slot.timer = null;
    job?.done(result);
  };

  /** @returns {Slot} */
  const spawn = () => {
    started++;
    /** @type {Slot} */
    const slot = {
      worker: new Worker(WORKER, {
        workerData: { babel, compiler, cwd, options },
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      }),
      job: null,
      timer: null,
    };
    slot.worker.on('message', (/** @type {{ id: number, result: CompileResult }} */ m) => {
      if (slot.job?.id === m.id) finish(slot, m.result);
      pump();
    });
    // A worker that dies (out of memory, a crash): its task fails, a new worker takes its place.
    const lost = () => {
      const i = slots.indexOf(slot);
      if (i < 0) return;
      slots.splice(i, 1);
      finish(slot, { error: 'compiler-error' });
      pump();
    };
    slot.worker.on('error', lost);
    slot.worker.on('exit', lost);
    slots.push(slot);
    return slot;
  };

  const pump = () => {
    if (closed) return;
    while (queue.length) {
      const slot = slots.find((s) => !s.job) ?? (slots.length < size ? spawn() : null);
      if (!slot) return;
      const job = /** @type {Job} */ (queue.shift());
      slot.job = job;
      slot.timer = setTimeout(() => {
        // Too slow: end this worker; the next task gets a new one.
        const i = slots.indexOf(slot);
        if (i >= 0) slots.splice(i, 1);
        finish(slot, { error: 'analysis-timeout' });
        void slot.worker.terminate();
        pump();
      }, timeoutMs);
      slot.worker.postMessage({ id: job.id, ...job.task });
    }
  };

  return {
    /**
     * Compile one file side.
     * @param {CompileTask} task
     * @returns {Promise<CompileResult>}
     */
    compile(task) {
      return new Promise((done) => {
        queue.push({ id: next++, task, done });
        pump();
      });
    },
    /** Workers started so far (replacements included). */
    get started() {
      return started;
    },
    /** End every worker; a task still running or waiting answers `compiler-error`. */
    async close() {
      closed = true;
      const all = slots.splice(0);
      for (const s of all) finish(s, { error: 'compiler-error' });
      for (const job of queue.splice(0)) job.done({ error: 'compiler-error' });
      await Promise.all(all.map((s) => s.worker.terminate()));
    },
  };
}
