/**
 * env.mjs — the render environment: which browser, OS, fonts and settings produced a render.
 *
 * `collectEnv` reads the facts once per browser (Node facts, plus one probe page that is not a
 * story); every baseline written from a render keeps that render's `env` in its `.psig` header
 * (docs/spec.md), and each check compares the render's env with its baseline's:
 *
 *   same        every field equal
 *   compatible  only minor fields differ (listed in `envDiff`, no warning)
 *   mismatch    a major field differs: the `env-mismatch` warning; with --strict-env, exit 2
 *   unknown     the baseline records no env (every baseline from before 0.5): nothing, ever
 *
 * Nothing here names a machine or a person: no hostname, user name, GPU model string or font
 * list is read into `env` (the GPU becomes a class; fonts become digests of measured widths).
 */
import { readHeader } from './psig.mjs';
import { canonical, major } from './env/id.mjs';
/** @import { CheckRow, Config, EnvComparison, EnvFields, EnvRecord, EnvSettings, EnvSummary, EnvTier, ManifestEntry } from '../types.js' */

export { CAPTURE_PIPELINE, canonical, ENV_VERSION, envId, majorView } from './env/id.mjs';
export {
  collectEnv,
  gpuClass,
  osFromProbe,
  playwrightVersion,
  PROBE_FAMILIES,
  PROBE_PAGE,
  systemFonts,
} from './env/collect.mjs';

/**
 * Every compared field, in report order: its path and its tier. `browser.version` is major on its
 * first number and minor on the rest; `fonts.probe` names the families that differ.
 * @type {[string, EnvTier][]}
 */
export const FIELDS = [
  ['browser.name', 'major'],
  ['browser.version', 'major'],
  ['browser.channel', 'major'],
  ['browser.launchArgs', 'major'],
  ['playwright', 'minor'],
  ['axe', 'minor'],
  ['os.platform', 'major'],
  ['os.arch', 'major'],
  ['os.release', 'minor'],
  ['os.distro', 'minor'],
  ['fonts.probe', 'major'],
  ['fonts.system', 'minor'],
  ['render.dpr', 'major'],
  ['render.gpu', 'major'],
  ['render.colorGamut', 'major'],
  ['render.timezone', 'major'],
  ['render.locale', 'major'],
  ['render.reducedMotion', 'major'],
  ['capture.pipeline', 'major'],
  ['container.image', 'minor'],
  ['container.revision', 'minor'],
  ['container.digest', 'minor'],
  ['pxsig', 'minor'],
  ['engine', 'minor'],
  ['node', 'minor'],
];
export const FIELD_NAMES = FIELDS.map(([f]) => f);

/** A value read out of a parsed env (JSON). */
/** @typedef {string | number | boolean | object | null | undefined} EnvValue */
/**
 * The value at a dotted path, or undefined.
 * @param {unknown} o
 * @param {string} path
 * @returns {EnvValue}
 */
const get = (o, path) =>
  path.split('.').reduce(
    (/** @type {EnvValue} */ v, k) =>
      // Indexing a primitive (a string field) reads undefined or a character, as before typing.
      v == null ? undefined : /** @type {Record<string, EnvValue>} */ (v)[k],
    /** @type {EnvValue} */ (o)
  );

/**
 * The font families whose probe digests differ (both sides' families).
 * @param {EnvFields | null | undefined} a
 * @param {EnvFields | null | undefined} b
 * @returns {string[]}
 */
export function fontFamiliesDiffering(a, b) {
  const fa = a?.fonts?.probe?.families ?? {};
  const fb = b?.fonts?.probe?.families ?? {};
  return [...new Set([...Object.keys(fa), ...Object.keys(fb)])]
    .filter((f) => fa[f] !== fb[f])
    .sort();
}

/**
 * Compare a baseline's env with a render's. Returns `{ match, diff, fonts? }`: `diff` lists the
 * differing fields (only when not `same`), `fonts` the font families when `fonts.probe` differs.
 * `ignore` (config `env.ignore`) leaves fields out of the comparison.
 * @param {EnvFields | null | undefined} base
 * @param {EnvFields | null | undefined} cur
 * @param {string[]} [ignore]
 * @returns {EnvComparison}
 */
export function compareEnv(base, cur, ignore = []) {
  if (!base || typeof base !== 'object') return { match: 'unknown' };
  if (!cur || typeof cur !== 'object') return { match: 'unknown' };
  const skip = new Set(ignore);
  /** @type {string[]} */
  const diff = [];
  let isMajor = false;
  for (const [f, tier] of FIELDS) {
    if (skip.has(f)) continue;
    const a = get(base, f);
    const b = get(cur, f);
    if (f === 'browser.version') {
      // `browser.version`: a version string, or missing.
      /** @typedef {string | null | undefined} Version */
      if (major(/** @type {Version} */ (a)) !== major(/** @type {Version} */ (b))) {
        diff.push(f);
        isMajor = true;
      } else if ((a ?? null) !== (b ?? null)) diff.push(f);
      continue;
    }
    if (f === 'fonts.probe') {
      // `fonts.probe` is `{ digest, families }` (or missing).
      /** @typedef {{ digest?: string } | null | undefined} Probe */
      if (
        (/** @type {Probe} */ (a)?.digest ?? null) !== (/** @type {Probe} */ (b)?.digest ?? null)
      ) {
        diff.push(f);
        isMajor = true;
      }
      continue;
    }
    if (canonical(a ?? null) !== canonical(b ?? null)) {
      diff.push(f);
      if (tier === 'major') isMajor = true;
    }
  }
  if (!diff.length) return { match: 'same' };
  const fonts = diff.includes('fonts.probe') ? fontFamiliesDiffering(base, cur) : null;
  return { match: isMajor ? 'mismatch' : 'compatible', diff, ...(fonts?.length ? { fonts } : {}) };
}

/**
 * "browser.version 141→142", "fonts.probe: Inter", "render.gpu angle-metal→swiftshader".
 * @param {EnvFields | null | undefined} base
 * @param {EnvFields | null | undefined} cur
 * @param {{ diff?: string[], fonts?: string[] }} cmp
 * @param {{ majorOnly?: boolean }} [opts]
 * @returns {string[]}
 */
export function describeDiff(base, cur, cmp, { majorOnly = true } = {}) {
  const tier = Object.fromEntries(FIELDS);
  /** @param {EnvValue} v */
  const show = (v) =>
    v == null
      ? 'none'
      : Array.isArray(v)
        ? v.length
          ? v.join(' ')
          : 'none'
        : typeof v === 'object'
          ? 'set'
          : String(v);
  return (cmp.diff ?? [])
    .filter((f) => !majorOnly || tier[f] === 'major')
    .map((f) => {
      if (f === 'fonts.probe') return `fonts.probe: ${(cmp.fonts ?? []).join(', ') || 'changed'}`;
      if (f === 'browser.version')
        // `browser.version`: a version string, or missing.
        return `browser.version ${major(/** @type {string | null | undefined} */ (get(base, f))) || '?'}→${major(/** @type {string | null | undefined} */ (get(cur, f))) || '?'}`;
      return `${f} ${show(get(base, f))}→${show(get(cur, f))}`;
    });
}

/**
 * Fills a checked row's env fields from the run's env (by its browser) and the engine's
 * `baselineEnv` id: `env`, `baselineEnv`, `envMatch`, `envDiff` (and `envFonts`) when not `same`.
 * @param {CheckRow} row
 * @param {{ current?: Record<string, EnvFields> | null, envs?: Record<string, EnvFields> | null, ignore?: string[] }} opts
 * @returns {CheckRow}
 */
export function annotateRow(row, { current, envs, ignore = [] }) {
  if (!row || row.skipped) return row;
  const cur = current?.[row.browser ?? 'chromium'] ?? null;
  const baseId = row.baselineEnv ?? null;
  const out = { ...row, env: cur?.id ?? null, baselineEnv: baseId };
  delete out.envDiff;
  delete out.envFonts;
  if (!cur || !baseId) return { ...out, envMatch: 'unknown' };
  const cmp = compareEnv(envs?.[baseId], cur, ignore);
  return {
    ...out,
    envMatch: cmp.match,
    ...(cmp.diff ? { envDiff: cmp.diff } : {}),
    ...(cmp.fonts ? { envFonts: cmp.fonts } : {}),
  };
}

/**
 * `summary.envMismatch` (checked rows whose baseline came from a different environment) and
 * `summary.envFields` (what differs, described, across those rows).
 * @param {CheckRow[]} rows
 * @param {Record<string, EnvFields>} [envs]
 * @returns {EnvSummary}
 */
export function envSummary(rows, envs = {}) {
  const mism = rows.filter((r) => !r.skipped && r.envMatch === 'mismatch');
  /** @type {string[]} */
  const fields = [];
  const seen = new Set();
  for (const r of mism) {
    // A row without an id looks up `envs[undefined]`: no env, as before typing.
    for (const d of describeDiff(
      envs[/** @type {string} */ (r.baselineEnv)],
      envs[/** @type {string} */ (r.env)],
      {
        diff: r.envDiff,
        fonts: r.envFonts,
      }
    )) {
      const key = d.split(/[ :]/)[0] + (d.startsWith('fonts.probe') ? d : '');
      if (seen.has(key)) continue;
      seen.add(key);
      fields.push(d);
    }
  }
  return { envMismatch: mism.length, ...(mism.length ? { envFields: fields.slice(0, 8) } : {}) };
}

/**
 * The `[check] env:` line, or null when nothing mismatches.
 * @param {Partial<EnvSummary> | null | undefined} summary
 * @param {number} checked
 */
export function envLine(summary, checked) {
  if (!summary?.envMismatch) return null;
  const what = summary.envFields?.length ? ` (${summary.envFields.join(', ')})` : '';
  return `env: ${summary.envMismatch} of ${checked} entries rendered in a different environment than their baseline${what} → pxsig doctor`;
}

/**
 * `--strict-env`: the selected baselines whose env is `mismatch` against the current env of
 * their browser. `unknown` (no env recorded) never counts. Returns `{ count, fields, ids }`.
 * @template {Pick<ManifestEntry, 'id'> & { browser?: string }} E
 * @param {E[]} entries
 * @param {(e: E) => string} sigPath
 * @param {Record<string, EnvFields | undefined>} current
 * @param {string[]} [ignore]
 * @returns {{ count: number, fields: string[], ids: string[] }}
 */
export function strictEnvCheck(entries, sigPath, current, ignore = []) {
  /** @type {string[]} */
  const bad = [];
  /** @type {Set<string>} */
  const fields = new Set();
  /** @type {Set<string>} */
  const fonts = new Set();
  for (const e of entries) {
    const cur = current[e.browser ?? 'chromium'];
    const base = readHeader(sigPath(e))?.env;
    if (!cur || !base) continue;
    const cmp = compareEnv(base, cur, ignore);
    if (cmp.match !== 'mismatch') continue;
    bad.push(e.id);
    for (const d of describeDiff(base, cur, cmp))
      fields.add(d.startsWith('fonts.probe') ? 'fonts.probe' : d);
    for (const f of cmp.fonts ?? []) fonts.add(f);
  }
  const list = [...fields].map((f) =>
    f === 'fonts.probe' ? `fonts.probe: ${[...fonts].join(', ')}` : f
  );
  return { count: bad.length, fields: list, ids: bad };
}

/**
 * The project's `env` settings with their defaults.
 * @param {Pick<Config, 'env'> | null | undefined} config
 * @returns {EnvSettings}
 */
export const envConfig = (config) => ({
  ignore: Array.isArray(config?.env?.ignore) ? config.env.ignore : [],
  fontProbe: Array.isArray(config?.env?.fontProbe) ? config.env.fontProbe : [],
  strict: config?.env?.strict === true,
});

/**
 * `{ <envId>: env }` for the run's environments (`{ chromium: env, … }`).
 * @param {Record<string, EnvRecord> | null | undefined} current
 * @returns {Record<string, EnvRecord>}
 */
export const byId = (current) =>
  Object.fromEntries(
    Object.values(current ?? {})
      .filter(Boolean)
      .map((e) => [e.id, e])
  );

/**
 * Whether `PXSIG_STRICT_ENV` asks for strict mode.
 * @param {NodeJS.ProcessEnv} [env]
 */
export const strictFromEnv = (env = process.env) =>
  /^(1|true|yes)$/i.test(env.PXSIG_STRICT_ENV ?? '');
