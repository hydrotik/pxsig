/**
 * serve/watch.mjs — the server's file watchers: the stores and sources that reschedule integrity
 * or tell pages a report changed, and `--watch`, where edits re-check what they can affect.
 */
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { relPath } from '../lib/paths.mjs';
import { enqueue } from './checks.mjs';
import { scheduleIntegrity } from './integrity.mjs';
import { sourceEdited, startReact } from './react.mjs';
/** @import { ServeContext } from '../types/serve.js' */

/**
 * @param {ServeContext} srv
 * @param {string} dir
 * @param {(file: string) => void} onChange
 * @param {(file: string) => boolean} [filter]
 */
export const watchFor = (srv, dir, onChange, filter = () => true) => {
  if (!existsSync(dir)) return;
  try {
    // Kept, so `stop()` closes it.
    srv.watchers.add(
      watch(dir, { recursive: true }, (_, file) => {
        if (!file || /(^|\/)(\.|node_modules\/)/.test(file) || !filter(file)) return;
        onChange(file);
      })
    );
  } catch (e) {
    // fs.watch throws Errors (no recursive watch on this platform, too many watchers).
    console.error(
      `[serve] cannot watch ${relPath(srv.ws.root, dir)}: ${/** @type {Error} */ (e).message}`
    );
  }
};

/**
 * Integrity follows the source, the baselines, the renders and the manifest; pages hear when a
 * producer rewrote a report.
 * @param {ServeContext} srv
 */
export function watchStores(srv) {
  for (const S of srv.states.values()) {
    const { P } = S;
    /** @param {string} why */
    const later = (why) => () => scheduleIntegrity(srv, S, why);
    /** @param {string} why a change that can change what an edit traces to */
    const retrace = (why) => () => {
      S.traces.clear();
      scheduleIntegrity(srv, S, why);
    };
    watchFor(
      srv,
      P.srcRoot,
      (file) => {
        retrace('source changed')();
        // The React results are out of date for a code file until the next analysis.
        if (/\.(tsx?|jsx?|mjs)$/.test(file)) sourceEdited(S, file);
      },
      (f) => /\.(tsx?|jsx?|mjs|css|json|mdx)$/.test(f)
    );
    watchFor(srv, P.store.baselines, later('baselines changed'));
    watchFor(srv, join(P.store.root, 'renders'), later('renders changed'), (f) =>
      f.startsWith('latest')
    );
    watchFor(srv, P.store.root, retrace('manifest changed'), (f) =>
      /^manifest(\..+)?\.json$/.test(f)
    );
    /** @type {NodeJS.Timeout | null} */
    let dataTimer = null;
    watchFor(
      srv,
      P.store.reports,
      (file) => {
        if (Date.now() < S.quietUntil || file.startsWith('.run')) return;
        // clearTimeout(null) does nothing, as clearTimeout(undefined) does.
        clearTimeout(/** @type {NodeJS.Timeout | undefined} */ (dataTimer));
        dataTimer = setTimeout(() => srv.broadcast('data', { project: S.name }), 300);
      },
      (f) => /\.(nd)?json$/.test(f)
    );
  }
}

// --- watch mode: edits re-check only what they can affect, and run the React analysis ----------
/** @param {ServeContext} srv */
export function watchSources(srv) {
  for (const S of srv.states.values()) {
    const src = S.P.srcRoot;
    /** @type {Set<string>} */
    const changed = new Set();
    /** @type {NodeJS.Timeout | null} */
    let t = null;
    watchFor(
      srv,
      src,
      (file) => {
        changed.add(relPath(srv.ws.root, join(src, file)));
        // clearTimeout(null) does nothing, as clearTimeout(undefined) does.
        clearTimeout(/** @type {NodeJS.Timeout | undefined} */ (t));
        // Give Storybook's dev server a moment to rebuild before we render.
        t = setTimeout(async () => {
          const files = [...changed];
          changed.clear();
          try {
            if (!S.runPath) return;
            const a = await srv.trace('affected', {
              manifest: S.runPath,
              root: srv.ws.root,
              files,
            });
            // Watch is not a gate: it re-checks what the edits trace to, and names what it cannot trace
            // (the gates would check everything for those; docs/ci.md).
            const ids = a.traced ?? a.ids;
            console.log(
              `[serve] ${S.name}: watch: ${files.join(', ')} → ${ids.length} entries (${a.failSafe?.length ? 'traced only' : a.reason})`
            );
            for (const f of a.failSafe ?? [])
              console.log(
                `[serve] ${S.name}: watch: not traced: ${f.why} (a gate would check every entry)`
              );
            srv.broadcast('watch', { project: S.name, files, ids: ids.length });
            // The compiler analysis follows a code edit (it skips what did not change).
            if (files.some((f) => /\.(tsx?|jsx?|mjs)$/.test(f))) startReact(srv, S, 'watch');
            if (ids.length) await enqueue(srv, S, { ids });
          } catch (e) {
            // The engine's and enqueue's errors are Errors.
            console.error(`[serve] ${S.name}: watch: ${/** @type {Error} */ (e).message}`);
          }
        }, 900);
      },
      (f) => !/(^|\/)(__pxsig__|node_modules)\//.test(f)
    );
    console.log(
      `[serve] ${S.name}: watching ${relPath(srv.ws.root, src)} — edits re-check affected entries`
    );
  }
}
