/**
 * serve/engine.mjs — the Rust engine the server keeps running: `pxsig serve` (stdio JSON, one
 * request and one answer per line), spawned on the first call and again after it exits.
 */
import { createInterface } from 'node:readline';
import { spawn } from '../lib/spawn.mjs';
/** @import { Readable, Writable } from 'node:stream' */
/**
 * @import { Engine, EngineMethod, EngineMethods, EnginePending, EngineReply } from '../types/t5.js'
 */

/**
 * The engine for the workspace at `root`, run from `bin` (lib/workspace.mjs `rustBinary`).
 * @param {string} root
 * @param {string} bin
 */
export function startEngine(root, bin) {
  /** @type {Engine | null} */
  let engine = null;
  /**
   * One call to the engine: its answer's `result`, or a rejection with its `error`.
   * @template {EngineMethod} M
   * @param {M} method
   * @param {EngineMethods[M]['params']} params
   * @returns {Promise<EngineMethods[M]['result']>}
   */
  function rust(method, params) {
    if (!engine) {
      const proc = spawn(bin, ['serve'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
      /** @type {Map<number | null, EnginePending>} */
      const pending = new Map();
      let seq = 0;
      // stdin and stdout are pipes (`stdio` above), so neither is null.
      createInterface({ input: /** @type {Readable} */ (proc.stdout) }).on('line', (line) => {
        // The engine writes one JSON object per line (crates/pxsig-cli/src/serve.rs); any other line
        // (not JSON, or JSON that is not an object) answers nothing and is skipped.
        /** @type {unknown} */
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        if (!parsed || typeof parsed !== 'object') return;
        const msg = /** @type {EngineReply} */ (parsed);
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (p) {
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
      });
      proc.on('exit', (code) => {
        for (const p of pending.values()) p.reject(new Error(`pxsig serve exited (${code})`));
        engine = null;
      });
      engine = {
        call(m, prm) {
          const id = ++seq;
          return new Promise((ok, fail) => {
            pending.set(id, { resolve: ok, reject: fail });
            // A pipe (`stdio` above), so not null.
            /** @type {Writable} */ (proc.stdin).write(
              `${JSON.stringify({ id, method: m, params: prm })}\n`
            );
          });
        },
        kill: () => proc.kill(),
      };
    }
    return engine.call(method, params);
  }
  return { rust, kill: () => engine?.kill() };
}
