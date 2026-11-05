/**
 * serve/traces.mjs — integrity's tracing, kept between passes. An approval writes a baseline, not
 * a source file, so the pass it triggers asks the engine about the same edited files as the pass
 * before and gets the same answers: that pass reuses them and makes no engine call. Any change to
 * the edited files (one more, one fewer, a new mtime), to the manifest's entries, a source change
 * the watcher saw, or a pass for any other reason traces again.
 */
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
/** @import { ProjectState } from './projects.mjs' */

/** The passes that may reuse: their trigger changes no source file and no manifest entry. */
export const REUSE = new Set(['baselines changed', 'renders changed']);

/**
 * One project's kept traces: `tracer()` wraps its `affected` for one pass, `clear()` forgets them.
 * reconcile calls the tracer once per edited file, all in one go (lib/integrity/reconcile.mjs), so
 * the calls are gathered first and the whole set is compared with the last pass's.
 */
export function traceCache() {
  /** @type {{ key: string, ids: Map<string, Promise<string[]>> } | null} */
  let last = null;
  return {
    clear() {
      last = null;
    },
    /**
     * @param {ProjectState} S
     * @param {string} root what the edited files are relative to (the integrity context's repoRoot)
     * @returns {(file: string) => Promise<string[]>}
     */
    tracer(S, root) {
      /** @type {{ file: string, ok: (ids: Promise<string[]>) => void }[]} */
      const calls = [];
      const flush = () => {
        const files = calls.map((c) => c.file);
        const key = keyOf(S, root, files);
        if (last && last.key === key) {
          // Same files, same mtimes, same entries: the answers the engine gave for them.
          const { ids } = last;
          for (const c of calls) c.ok(/** @type {Promise<string[]>} */ (ids.get(c.file)));
          return;
        }
        /** @type {Map<string, Promise<string[]>>} */
        const ids = new Map(files.map((f) => [f, S.affected(f)]));
        const kept = { key, ids };
        last = kept;
        for (const c of calls) c.ok(/** @type {Promise<string[]>} */ (ids.get(c.file)));
        // A failed trace is not kept: the next pass asks again.
        Promise.all(ids.values()).catch(() => {
          if (last === kept) last = null;
        });
      };
      return (file) =>
        new Promise((ok) => {
          if (!calls.length) queueMicrotask(flush);
          calls.push({ file, ok });
        });
    },
  };
}

/**
 * The edited files with their mtimes and the manifest's entries, as one string.
 * @param {ProjectState} S
 * @param {string} root
 * @param {string[]} files
 */
function keyOf(S, root, files) {
  const h = createHash('sha256');
  h.update(JSON.stringify(S.manifest.stories.map((e) => [e.id, e.importPath ?? null])));
  for (const f of [...files].sort()) {
    let t = null;
    try {
      t = statSync(join(root, f)).mtimeMs;
    } catch {
      // gone since reconcile listed it (a deletion under srcRoot also clears the cache)
      t = -1;
    }
    h.update(`\n${f}\0${t}`);
  }
  return h.digest('hex');
}
