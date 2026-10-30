/**
 * tools/staleness.mjs — which entries a set of files can affect (the Rust engine), which verdicts
 * are older than the files they cover, the prune plan, and where an entry's images are.
 */
import { spawnSync } from '../lib/spawn.mjs';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readImage } from '../lib/psig.mjs';
import { writeRunManifest } from '../lib/workspace.mjs';
import { relPath } from '../lib/paths.mjs';
import { buildPlan } from '../lib/prune.mjs';
import { ctxOf, readJson } from './context.mjs';

/** @import { CheckRow, ManifestEntry } from '../types.js' */
/** @import { AffectedResult, CheckReport, HistoryLine, PrunePlanOptions } from '../types/t6.js' */
/** @import { ProjectContext } from './context.mjs' */

// --- the Rust engine: which entries can a set of files affect? ----------------------------------

/**
 * @param {ProjectContext} C
 * @param {{ files?: string[], since?: string, manifestPath?: string }} opts
 * @returns {AffectedResult}
 */
function affected(C, { files, since, manifestPath }) {
  if (!existsSync(C.rustBin)) throw new Error(`the pxsig binary is missing: ${C.rustBin}`);
  // Callers pass files or since.
  const how = files?.length
    ? ['--files', files.join(',')]
    : ['--since', /** @type {string} */ (since)];
  const run = writeRunManifest(C.P, manifestPath).path;
  const r = spawnSync(
    C.rustBin,
    ['affected', '--manifest', run, '--root', C.root, ...how, '--json'],
    {
      cwd: C.root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  if (r.status !== 0) throw new Error(`pxsig affected failed: ${r.stderr || r.stdout}`);
  // the engine's `affected --json`
  return /** @type {AffectedResult} */ (JSON.parse(r.stdout));
}

/**
 * Sources whose edits can change a render: the project's srcRoot plus its `affects` folders.
 * @param {ProjectContext} C
 */
function sourceRoots(C) {
  const roots = [
    C.P.srcRoot,
    ...C.P.affects.filter((a) => !/\.[a-z]+$/i.test(a)).map((a) => resolve(C.root, a)),
  ];
  return [...new Set(roots)].filter((r) => existsSync(r) && statSync(r).isDirectory());
}

/**
 * Source files edited after `when` (tests excluded), with their edit times.
 * @overload
 * @param {ProjectContext} C
 * @param {Date} when
 * @param {{ withTimes: true }} opts
 * @returns {{ file: string, mtime: Date }[]}
 */
/**
 * Source files edited after `when` (tests excluded).
 * @overload
 * @param {ProjectContext} C
 * @param {Date} when
 * @param {{ withTimes?: false }} [opts]
 * @returns {string[]}
 */
/**
 * @param {ProjectContext} C
 * @param {Date} when
 * @param {{ withTimes?: boolean }} [opts]
 * @returns {string[] | { file: string, mtime: Date }[]}
 */
function editedSince(C, when, { withTimes = false } = {}) {
  /** @type {(string | { file: string, mtime: Date })[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name.startsWith('.') || name.name === 'node_modules' || name.name === '__pxsig__')
        continue;
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (/\.(tsx?|mjs|jsx?|json)$/.test(name.name) && !/\.test\./.test(name.name)) {
        const mtime = statSync(p).mtime;
        if (mtime > when)
          out.push(withTimes ? { file: relPath(C.root, p), mtime } : relPath(C.root, p));
      }
    }
  };
  for (const root of sourceRoots(C)) walk(root);
  // With withTimes every item is an object, else every item is a path.
  return withTimes
    ? /** @type {{ file: string, mtime: Date }[]} */ (out).sort((a, b) =>
        a.file < b.file ? -1 : 1
      )
    : /** @type {string[]} */ (out).sort();
}

/**
 * When an entry's latest render was written, or null.
 * @param {ProjectContext} C
 * @param {string} id
 */
function renderedAt(C, id) {
  const p = imagePath(C, 'current', id);
  // No manifest entry: existsSync(null) is false, so null, as before typing.
  return existsSync(/** @type {string} */ (p)) ? statSync(/** @type {string} */ (p)).mtime : null;
}

/**
 * Width × height from a PNG's IHDR, without decoding it.
 * @param {string | null} p
 * @returns {[number, number] | null}
 */
function pngSize(p) {
  try {
    // No path (no manifest entry): readFileSync throws, so null, as before typing.
    const b = readFileSync(/** @type {string} */ (p)).subarray(16, 24);
    return [b.readUInt32BE(0), b.readUInt32BE(4)];
  } catch {
    return null;
  }
}

/**
 * When each row's verdict was made: its own `checkedAt` (rows written since that
 * field exists), else the latest history run that included it, else the report's
 * full-check time. Render file times are not used: a run can rewrite the PNGs
 * without updating the report.
 * @param {ProjectContext} C
 * @param {CheckReport} check
 * @returns {Map<string, { at: Date, source: string }>}
 */
function verdictTimes(C, check) {
  /** @type {Map<string, Date>} */
  const fromHistory = new Map();
  if (existsSync(C.historyPath))
    for (const line of readFileSync(C.historyPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        // a line the engine appended (a torn one throws here)
        const h = /** @type {HistoryLine} */ (JSON.parse(line));
        for (const id of Object.keys(h.rows ?? {})) fromHistory.set(id, new Date(h.at));
      } catch {
        /* a torn line from a concurrent writer */
      }
    }
  const full = new Date(check.generatedAt);
  return new Map(
    check.rows.map(
      /** @returns {[string, { at: Date, source: string }]} */ (r) => {
        if (r.checkedAt) return [r.id, { at: new Date(r.checkedAt), source: 'row' }];
        const h = fromHistory.get(r.id);
        if (h && h > full) return [r.id, { at: h, source: 'history' }];
        return [r.id, { at: full, source: 'full check' }];
      }
    )
  );
}

/**
 * Which rows of a report cannot be trusted as current (what pxsig_stale reports): `stale` (a file
 * that can change the entry was edited after its verdict, traced through the Rust import graph)
 * and `inconsistent` (the row's pixel size differs from the render on disk). `manifestPath` traces
 * a suite's report against its own manifest. Above `maxFiles` edited files, `tooMany` is set and
 * nothing is traced.
 * @param {ProjectContext} C
 * @param {CheckReport} check
 * @param {{ maxFiles?: number, manifestPath?: string }} [opts]
 */
function staleness(C, check, { maxFiles = 400, manifestPath } = {}) {
  const times = verdictTimes(C, check);
  /** @type {Record<string, number>} */
  const sources = {};
  for (const t of times.values()) sources[t.source] = (sources[t.source] ?? 0) + 1;
  const oldest = new Date(Math.min(...[...times.values()].map((t) => t.at.getTime())));
  /** @type {{ id: string, row: string, render: string }[]} */
  const inconsistent = [];
  for (const r of check.rows) {
    if (!r.pixels?.width) continue;
    const size = pngSize(imagePath(C, 'current', r.id));
    if (size && (size[0] !== r.pixels.width || size[1] !== r.pixels.height))
      inconsistent.push({
        id: r.id,
        row: `${r.pixels.width}x${r.pixels.height}`,
        render: `${size[0]}x${size[1]}`,
      });
  }
  const oldestIso = Number.isFinite(oldest.getTime()) ? oldest.toISOString() : null;
  if (!oldestIso)
    return { stale: [], inconsistent, sources, oldest: null, filesTraced: 0, tooMany: 0 };
  const edited = editedSince(C, oldest, { withTimes: true });
  if (edited.length > maxFiles)
    return {
      stale: [],
      inconsistent,
      sources,
      oldest: oldestIso,
      filesTraced: 0,
      tooMany: edited.length,
    };
  // id → the latest edit among files that affect it.
  /** @type {Map<string, Date>} */
  const lastEdit = new Map();
  /** @type {Map<string, string>} */
  const culprit = new Map();
  for (const { file, mtime } of edited) {
    /** @type {string[]} */
    let ids;
    try {
      const a = affected(C, { files: [file], manifestPath });
      ids = a.traced ?? a.ids;
    } catch {
      continue;
    }
    for (const id of ids)
      // has(id) is checked first: get(id) is a Date.
      if (!lastEdit.has(id) || mtime > /** @type {Date} */ (lastEdit.get(id))) {
        lastEdit.set(id, mtime);
        culprit.set(id, file);
      }
  }
  const stale = check.rows
    // Every row has a verdict time, and lastEdit.has(r.id) is checked first.
    .filter(
      (r) =>
        lastEdit.has(r.id) &&
        /** @type {{ at: Date }} */ (times.get(r.id)).at < /** @type {Date} */ (lastEdit.get(r.id))
    )
    // culprit is set with lastEdit
    .map((r) => ({ id: r.id, editedAfter: /** @type {string} */ (culprit.get(r.id)) }));
  return {
    stale,
    inconsistent,
    sources,
    oldest: oldestIso,
    filesTraced: edited.length,
    tooMany: 0,
  };
}

/**
 * `pxsig a11y --prune` and `pxsig_a11y { prune_plan }`: every accepted axe rule classified
 * (lib/prune.mjs), with staleness from the same test as pxsig_stale, per report.
 * @param {PrunePlanOptions} [opts]
 */
async function prunePlan({ project, component, mode, only, cmd = 'pxsig', maxFiles = 400 } = {}) {
  const C = ctxOf(project);
  /** @type {Map<string, string | null>} */
  const modes = new Map();
  const suites = new Set(Object.keys(C.P.config?.suites ?? {}));
  for (const f of existsSync(C.P.store.root) ? readdirSync(C.P.store.root) : [])
    if (/^manifest\.(.+)\.json$/.test(f)) suites.add(f.slice(9, -5));
  for (const suite of [null, ...suites])
    for (const e of /** @type {{ stories?: ManifestEntry[] }} */ (
      readJson(C.P.manifestPath(suite), { stories: [] })
    ).stories ?? [])
      if (!modes.has(e.id)) modes.set(e.id, e.mode ?? null);
  /** @param {{ suite: string | null, path: string, file: string, check: { rows: CheckRow[], generatedAt?: string } }} rep a report (lib/prune.mjs `readReports`) */
  const stale = (rep) => {
    const mp = C.P.manifestPath(rep.suite);
    if (!existsSync(mp))
      return {
        ids: new Map(),
        unknown: `no manifest for ${rep.suite ? `suite ${rep.suite}` : 'the project'}: cannot tell whether it is stale`,
      };
    let st;
    try {
      // a check.json pxsig wrote: it has generatedAt, and its rows are report rows
      st = staleness(C, /** @type {CheckReport} */ (rep.check), { maxFiles, manifestPath: mp });
    } catch (e) {
      return {
        ids: new Map(),
        unknown: `staleness could not be traced (${/** @type {Error} */ (e).message})`,
      };
    }
    if (st.tooMany)
      return {
        ids: new Map(),
        unknown: `${st.tooMany} source files edited since ${rep.file} was checked: too many to trace`,
      };
    const ids = new Map(st.stale.map((x) => [x.id, x.editedAfter]));
    for (const x of st.inconsistent)
      if (!ids.has(x.id)) ids.set(x.id, `its render (${x.render}, the row says ${x.row})`);
    return { ids, unknown: null };
  };
  // buildPlan's options as lib/prune.mjs takes them (its untyped `= null` defaults read as null only)
  return /** @type {(P: import('../types.js').Project, options: { stale: typeof stale, modeOf: (id: string) => string | null, only?: string[], component?: string, mode?: string, cmd?: string }) => ReturnType<typeof buildPlan>} */ (
    buildPlan
  )(C.P, {
    stale,
    modeOf: (/** @type {string} */ id) => modes.get(id) ?? null,
    only,
    component,
    mode,
    cmd,
  });
}

// --- images --------------------------------------------------------------------------------------

/**
 * Where an image lives: the latest render and the diff are files; the baseline is in the .psig.
 * @param {ProjectContext} C
 * @param {string} kind
 * @param {string} id
 * @returns {string | null}
 */
function imagePath(C, kind, id) {
  if (kind === 'current') return join(C.P.store.latest, `${id}.png`);
  if (kind === 'diff') return join(C.P.store.diffLatest, `${id}.diff.png`);
  const e = (/** @type {{ stories?: ManifestEntry[] }} */
  (readJson(C.P.manifestPath(), { stories: [] })).stories ?? []).find((x) => x.id === id);
  return e ? resolve(C.root, e.sig) : null;
}

/**
 * An image's bytes and where they came from, or null.
 * @param {ProjectContext} C
 * @param {string} kind
 * @param {string} id
 */
export function imageOf(C, kind, id) {
  const p = imagePath(C, kind, id);
  if (!p || !existsSync(p))
    return { bytes: null, where: p ? relPath(C.root, p) : 'no manifest entry' };
  const bytes = kind === 'baseline' ? readImage(p) : readFileSync(p);
  return {
    bytes,
    where: kind === 'baseline' ? `${relPath(C.root, p)} (image section)` : relPath(C.root, p),
  };
}

export { affected, editedSince, prunePlan, renderedAt, sourceRoots, staleness, verdictTimes };
