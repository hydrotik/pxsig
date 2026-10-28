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
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import { spawnSync } from './spawn.mjs';
import { readHeader } from './psig.mjs';
/** @import { CheckRow, Config, EnvBrowser, EnvComparison, EnvFields, EnvProbe, EnvRecord, EnvSettings, EnvSummary, EnvTier, ManifestEntry, RemoteBrowser } from '../types.js' */

export const ENV_VERSION = 1;

/**
 * Bumped when capture code changes what a render looks like (the freeze stylesheet, the waits,
 * the screenshot options): baselines from an older pipeline then compare as `mismatch`.
 */
export const CAPTURE_PIPELINE = 1;

/** Families every font probe measures; `env.fontProbe` adds more (the design system's). */
export const PROBE_FAMILIES = ['serif', 'sans-serif', 'monospace', 'system-ui'];
const PROBE_TEXT = 'Hamburgefonstiv 0123456789 ÅÉß —→';
const PROBE_SIZES = [12, 16, 32];

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
/** @param {string} s */
const sha = (s) => createHash('sha256').update(s).digest('hex');
/** @param {string | null | undefined} v a version */
const major = (v) => String(v ?? '').split('.')[0];

/**
 * JSON with sorted keys at every level, so equal objects hash equal.
 * @param {unknown} v
 * @returns {string}
 */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) => `${JSON.stringify(k)}:${canonical(/** @type {Record<string, unknown>} */ (v)[k])}`
      )
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

/**
 * The major fields only: what `id` is computed over.
 * @param {EnvFields} env
 */
export function majorView(env) {
  return {
    browser: {
      name: env.browser?.name ?? null,
      major: major(env.browser?.version),
      channel: env.browser?.channel ?? null,
      launchArgs: env.browser?.launchArgs ?? [],
    },
    os: { platform: env.os?.platform ?? null, arch: env.os?.arch ?? null },
    fonts: { probe: env.fonts?.probe?.digest ?? null },
    render: Object.fromEntries(
      /** @type {(keyof EnvRecord['render'])[]} */ ([
        'dpr',
        'gpu',
        'colorGamut',
        'timezone',
        'locale',
        'reducedMotion',
      ]).map((k) => [k, env.render?.[k] ?? null])
    ),
    capture: { pipeline: env.capture?.pipeline ?? null },
  };
}

/**
 * First 16 hex of sha256 over the canonical JSON of the major fields.
 * @param {EnvFields} env
 */
export const envId = (env) => sha(canonical(majorView(env))).slice(0, 16);

/**
 * The GPU renderer string reduced to a class; the string itself (it names the machine model) is never kept.
 * @param {string | null | undefined} renderer
 * @returns {string}
 */
export function gpuClass(renderer) {
  if (renderer === null) return 'none';
  const s = String(renderer ?? '');
  if (!s) return 'masked';
  if (/swiftshader|llvmpipe|software/i.test(s)) return 'swiftshader';
  if (/metal/i.test(s)) return 'angle-metal';
  if (/vulkan/i.test(s)) return 'angle-vulkan';
  if (/angle|opengl|mesa|direct3d|d3d|gl/i.test(s)) return 'angle-gl';
  return 'masked';
}

/**
 * Runs in the probe page: canvas text widths per family and size, WebGL renderer, gamut, Intl.
 * @param {{ families: string[], text: string, sizes: number[] }} input
 * @returns {EnvProbe}
 */
export const PROBE_PAGE = ({ families, text, sizes }) => {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  /** @type {Record<string, number[]>} */
  const widths = {};
  for (const f of families) {
    widths[f] = sizes.map((px) => {
      g.font = `${px}px ${/[\s,]/.test(f) && !/^["']/.test(f) ? JSON.stringify(f) : f}`;
      return Math.round(g.measureText(text).width * 1000) / 1000;
    });
  }
  let renderer = null;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer =
        (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '';
    }
  } catch {
    renderer = null;
  }
  const opts = Intl.DateTimeFormat().resolvedOptions();
  return {
    widths,
    renderer,
    colorGamut: matchMedia('(color-gamut: p3)').matches
      ? 'p3'
      : matchMedia('(color-gamut: srgb)').matches
        ? 'srgb'
        : 'unknown',
    timezone: opts.timeZone ?? null,
    locale: navigator.language ?? null,
    // For a remote browser only (lib/capture.mjs connectBrowser): its OS, as the page sees it.
    platform: navigator.platform ?? null,
  };
};

/**
 * A remote browser's OS from its page (`navigator.platform`): `Linux x86_64`, `Linux aarch64`,
 * `MacIntel`, `Win32`. Release and distro are not visible from a page, so they stay null.
 * @param {string | null | undefined} platform
 * @returns {EnvRecord['os']}
 */
export function osFromProbe(platform) {
  const p = String(platform ?? '');
  if (/linux/i.test(p))
    return {
      platform: 'linux',
      arch: /aarch64|arm64|armv8/i.test(p) ? 'arm64' : /x86_64|amd64/i.test(p) ? 'x64' : null,
      release: null,
      distro: null,
    };
  if (/^mac/i.test(p)) return { platform: 'darwin', arch: null, release: null, distro: null };
  if (/^win/i.test(p)) return { platform: 'win32', arch: 'x64', release: null, distro: null };
  return { platform: null, arch: null, release: null, distro: null };
}

/**
 * `/etc/os-release` PRETTY_NAME on Linux, `os.version()` elsewhere.
 * @param {string} platform
 * @returns {string | null}
 */
function distro(platform) {
  if (platform === 'linux') {
    try {
      const m = readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]*)"?/m);
      if (m) return m[1];
    } catch {
      /* fall through */
    }
  }
  try {
    // macOS appends the build date and kernel build (": Mon Jul 14 …; root:xnu-…"): the version is enough.
    return os.version().split(/[;:]/)[0].trim() || null;
  } catch {
    return null;
  }
}

/**
 * sha256 of sorted `fc-list : family style` where fontconfig exists (Linux, the container); else
 * null. The image workflow writes the same digest to the image label `io.pxsig.fonts`.
 * @param {string} [platform]
 * @returns {string | null}
 */
export function systemFonts(platform = os.platform()) {
  if (platform !== 'linux') return null;
  try {
    const r = spawnSync('fc-list', [':', 'family', 'style'], { encoding: 'utf8', timeout: 5000 });
    if (r.status !== 0 || !r.stdout) return null;
    return sha(
      r.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .sort()
        .join('\n')
    );
  } catch {
    return null;
  }
}

/**
 * `version` of the Playwright package pxsig resolved, or null.
 * @param {() => string | null | undefined} resolvePkg
 * @returns {string | null}
 */
export function playwrightVersion(resolvePkg) {
  try {
    const p = resolvePkg();
    return p && existsSync(p)
      ? // Playwright's package.json: its `version` is a string.
        (/** @type {{ version?: string }} */ (JSON.parse(readFileSync(p, 'utf8'))).version ?? null)
      : null;
  } catch {
    return null;
  }
}

/**
 * The environment of one launched browser. `browser` is a Playwright Browser; `type` the engine
 * name; `channel` the channel it launched with. The probe page is a fresh context with the
 * capture settings (DPR 1, reduced motion), closed before returning.
 * @param {EnvBrowser} browser
 * @param {{ type?: string, channel?: string | null, launchArgs?: string[], fontProbe?: string[], playwright?: string | null, pxsig?: string | null, engine?: string | null, remote?: RemoteBrowser | null, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<EnvRecord>}
 */
export async function collectEnv(
  browser,
  {
    type = 'chromium',
    channel = null,
    launchArgs = [],
    fontProbe = [],
    playwright = null,
    pxsig = null,
    engine = null,
    remote = null,
    env = process.env,
  } = {}
) {
  const families = [...new Set([...PROBE_FAMILIES, ...fontProbe])];
  const ctx = await browser.newContext({
    viewport: { width: 400, height: 300 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  /** @type {EnvProbe} */
  let probe;
  try {
    const page = await ctx.newPage();
    await page.setContent(
      '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'
    );
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
    // What PROBE_PAGE returned, serialised back from the page.
    probe = /** @type {EnvProbe} */ (
      await page.evaluate(PROBE_PAGE, { families, text: PROBE_TEXT, sizes: PROBE_SIZES })
    );
  } finally {
    await ctx.close().catch(() => {});
  }
  const perFamily = Object.fromEntries(
    families.map((f) => [f, sha(JSON.stringify(probe.widths[f] ?? null)).slice(0, 8)])
  );
  const platform = os.platform();
  // A remote browser (`remote`: a browser server this process connected to) renders on its own
  // machine: its OS comes from the probe page, its image from what `pxsig browser start` recorded,
  // and this machine's fonts are not its fonts.
  const rec = remote?.record ?? null;
  const container = remote
    ? rec?.image || rec?.digest
      ? { image: rec.image ?? null, revision: rec.revision ?? null, digest: rec.digest ?? null }
      : null
    : env.PXSIG_IMAGE || env.PXSIG_IMAGE_REVISION || env.PXSIG_IMAGE_DIGEST
      ? {
          image: env.PXSIG_IMAGE || null,
          revision: env.PXSIG_IMAGE_REVISION || null,
          digest: env.PXSIG_IMAGE_DIGEST || null,
        }
      : null;
  /** @type {EnvFields} */
  const out = {
    v: ENV_VERSION,
    browser: {
      name: browser.browserType?.().name?.() ?? type,
      version: browser.version?.() ?? null,
      channel: channel ?? null,
      launchArgs,
    },
    playwright,
    os: remote
      ? osFromProbe(probe.platform)
      : { platform, arch: os.arch(), release: os.release(), distro: distro(platform) },
    fonts: {
      probe: { digest: sha(canonical(perFamily)), families: perFamily },
      system: remote ? null : systemFonts(platform),
    },
    render: {
      dpr: 1,
      gpu: gpuClass(probe.renderer),
      colorGamut: probe.colorGamut,
      timezone: probe.timezone,
      locale: probe.locale,
      reducedMotion: 'reduce',
    },
    capture: { pipeline: CAPTURE_PIPELINE },
    container,
    pxsig,
    engine,
    node: process.version,
  };
  out.id = envId(out);
  // `id` is set just above.
  return /** @type {EnvRecord} */ (out);
}

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
      if (major(/** @type {Version} */ (a)) !== major(/** @type {Version} */ (b)))
        (diff.push(f), (isMajor = true));
      else if ((a ?? null) !== (b ?? null)) diff.push(f);
      continue;
    }
    if (f === 'fonts.probe') {
      // `fonts.probe` is `{ digest, families }` (or missing).
      /** @typedef {{ digest?: string } | null | undefined} Probe */
      if ((/** @type {Probe} */ (a)?.digest ?? null) !== (/** @type {Probe} */ (b)?.digest ?? null))
        (diff.push(f), (isMajor = true));
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
