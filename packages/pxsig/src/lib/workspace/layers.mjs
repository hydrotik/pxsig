/**
 * Config layers (workspace.mjs): the built-in defaults, the deep merge, path anchoring, the CLI flags
 * layer, which layer set each key, and mode inheritance.
 */
/** @import { Flags, Mode, Workspace } from '../../types.js' */
import { isAbsolute, resolve } from 'node:path';
import { SetupError } from './core.mjs';

/** Built-in defaults. Nothing here names a repository, a path outside the project or a library. */
export const DEFAULTS = Object.freeze({
  srcRoot: 'src',
  storybook: { url: 'http://localhost:6006', configDir: null, staticDir: null },
  store: { dir: '.pxsig', layout: 'package' },
  capture: {
    viewport: [900, 600],
    settleMs: 200,
    target: '#storybook-root',
    waitFor: [],
    browserEndpoint: null,
  },
  grid: 64,
  minCellPx: 8,
  detail: true,
  trim: { pad: 16, tolerance: 8 },
  gate: {
    threshold: 24,
    minCells: 3,
    minSsim: 0.99,
    maxChangedPct: 2,
    detail: { blockDelta: 32, energyDelta: 48, minTiles: 3 },
  },
  modes: { default: { globals: '', colorScheme: 'light' } },
  defaultMode: null,
  modesByDefault: null,
  suites: {},
  affects: { workspaceDeps: true, extra: [], ignore: [], aliases: {}, unresolved: [] },
  nonVisual: [],
  a11y: true,
  integrity: {},
});

/** A plain object (a config layer, a JSON object): what `merge` merges. */
/** @typedef {Record<string, unknown>} Obj */
/** The CLI flags layer (`flagLayer`): config keys only. */
/** @typedef {{ storybook?: { url?: string, staticDir?: string, configDir?: string }, grid?: number, minCellPx?: number, capture?: { settleMs?: number, browserEndpoint?: string } }} FlagLayer */
/**
 * @param {unknown} v
 * @returns {v is Obj}
 */
export const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep merge for config layers: objects merge, everything else (arrays included) replaces.
 * @param {...unknown} layers
 * @returns {Obj}
 */
export function merge(...layers) {
  /** @type {Obj} */
  const out = {};
  for (const l of layers) {
    if (!isObj(l)) continue;
    for (const [k, v] of Object.entries(l))
      out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  }
  return out;
}

/**
 * `$workspace/x` → workspace-relative; anything else → relative to `base`. Returns absolute.
 * @overload
 * @param {Pick<Workspace, 'root'>} ws
 * @param {string} base
 * @param {string} p
 * @returns {string}
 */
/**
 * @overload
 * @param {Pick<Workspace, 'root'>} ws
 * @param {string} base
 * @param {string | null | undefined} p
 * @returns {string | null}
 */
/**
 * @param {Pick<Workspace, 'root'>} ws
 * @param {string} base
 * @param {string | null | undefined} p
 * @returns {string | null}
 */
export function expand(ws, base, p) {
  if (p == null) return null;
  if (p.startsWith('$workspace/')) return resolve(ws.root, p.slice('$workspace/'.length));
  return isAbsolute(p) ? p : resolve(base, p);
}

/** The path-valued config keys (dotted), for resolving each layer's paths against its own file. */
const PATH_KEYS = ['srcRoot', 'storybook.configDir', 'storybook.staticDir', 'store.dir'];

/**
 * A copy of `layer` with its relative paths made absolute against `base` (`$workspace/` kept).
 * @param {Workspace} ws
 * @param {Obj} layer
 * @param {string} base
 * @returns {Obj}
 */
export function anchorPaths(ws, layer, base) {
  if (!isObj(layer)) return layer;
  const out = merge(layer);
  /** @param {unknown} p */
  const fix = (p) =>
    typeof p === 'string' && !p.startsWith('$workspace/') ? expand(ws, base, p) : p;
  for (const key of PATH_KEYS) {
    const [a, b] = key.split('.');
    // With `b`, the condition checked that `out[a]` is an object.
    if (b ? isObj(out[a]) && out[a][b] != null : out[a] != null) {
      if (b) /** @type {Obj} */ (out[a])[b] = fix(/** @type {Obj} */ (out[a])[b]);
      else out[a] = fix(out[a]);
    }
  }
  if (isObj(out.affects) && Array.isArray(out.affects.extra))
    out.affects.extra = out.affects.extra.map(fix);
  for (const k of ['ignore', 'unresolved'])
    if (isObj(out.affects) && Array.isArray(out.affects[k]))
      // The condition checked that it is an array.
      out.affects[k] = /** @type {unknown[]} */ (out.affects[k]).map((g) =>
        typeof g === 'string' && g.startsWith('$repo/') ? g : fix(g)
      );
  if (isObj(out.affects) && isObj(out.affects.aliases))
    out.affects.aliases = Object.fromEntries(
      Object.entries(out.affects.aliases).map(([k, v]) => [k, fix(v)])
    );
  return out;
}

/**
 * The CLI flags layer (layer 1). Maps the config flags every command accepts onto config keys;
 * paths are relative to `cwd`. Unknown flags are ignored (they belong to the command).
 *
 *   --storybook-url u      storybook.url          --storybook-static dir   storybook.staticDir
 *   --storybook-config d   storybook.configDir    --grid n                 grid
 *   --min-cell-px n        minCellPx              --settle-ms n            capture.settleMs
 *   --browser ws://…       capture.browserEndpoint
 *
 * Each value is read again after the check on its line, so the casts below hold.
 * @param {Flags} [flags]
 * @param {string} [cwd]
 * @returns {FlagLayer}
 */
export function flagLayer(flags = {}, cwd = process.cwd()) {
  /**
   * @param {string} k
   * @returns {string | null}
   */
  const str = (k) => (typeof flags[k] === 'string' && flags[k] !== '' ? flags[k] : null);
  /**
   * @param {string} k
   * @returns {number | null}
   */
  const num = (k) => (str(k) != null && Number.isFinite(Number(str(k))) ? Number(str(k)) : null);
  /** @type {FlagLayer} */
  const out = {};
  /** @type {{ url?: string, staticDir?: string, configDir?: string }} */
  const sb = {};
  if (str('storybook-url')) sb.url = /** @type {string} */ (str('storybook-url'));
  if (str('storybook-static'))
    sb.staticDir = resolve(cwd, /** @type {string} */ (str('storybook-static')));
  if (str('storybook-config'))
    sb.configDir = resolve(cwd, /** @type {string} */ (str('storybook-config')));
  if (Object.keys(sb).length) out.storybook = sb;
  if (num('grid') != null) out.grid = /** @type {number} */ (num('grid'));
  if (num('min-cell-px') != null) out.minCellPx = /** @type {number} */ (num('min-cell-px'));
  if (num('settle-ms') != null)
    out.capture = { settleMs: /** @type {number} */ (num('settle-ms')) };
  if (str('browser'))
    out.capture = { ...out.capture, browserEndpoint: /** @type {string} */ (str('browser')) };
  return out;
}

/**
 * Which layer set each key: dotted path → layer name, for every leaf of the merged config (arrays
 * and `modes` count as one value). Later layers win, as in `merge`.
 * @param {{ name: string, value: unknown }[]} layers
 * @returns {Record<string, string>}
 */
export function provenance(layers) {
  /** @type {Record<string, string>} */
  const out = {};
  /**
   * @param {Obj} obj
   * @param {string} prefix
   * @param {string} name
   */
  const walk = (obj, prefix, name) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (isObj(v) && key !== 'modes' && !(prefix === '' && k === 'suites')) {
        // An object replaces nothing: its own leaves carry the layer.
        walk(v, key, name);
      } else {
        for (const o of Object.keys(out)) if (o.startsWith(`${key}.`)) delete out[o];
        out[key] = name;
      }
    }
  };
  for (const { name, value } of layers) if (isObj(value)) walk(value, '', name);
  return out;
}

/**
 * Resolve `extends` in a set of modes, through any number of levels: a mode is its parent's
 * settings with its own on top. A cycle or an unknown parent is a setup error.
 * @param {Record<string, Mode>} modes
 * @param {string | null} [where]
 * @returns {Record<string, Mode>}
 */
export function resolveModes(modes, where = 'modes') {
  /** @type {Record<string, Mode>} */
  const done = {};
  /**
   * @param {string} name
   * @param {string[]} chain
   * @returns {Mode}
   */
  const visit = (name, chain) => {
    if (done[name]) return done[name];
    const m = modes[name];
    if (!isObj(m))
      throw new SetupError(
        `${where}: mode "${chain.at(-2) ?? name}" extends "${name}", which is not defined`
      );
    if (!m.extends) return (done[name] = { ...m });
    if (chain.includes(m.extends))
      throw new SetupError(
        `${where}: modes extend each other in a cycle: ${[...chain, m.extends].join(' → ')}`
      );
    const parent = visit(m.extends, [...chain, m.extends]);
    const { extends: _, ...own } = m;
    return (done[name] = { ...parent, ...own });
  };
  for (const name of Object.keys(modes)) visit(name, [name]);
  return Object.fromEntries(Object.keys(modes).map((k) => [k, done[k]]));
}
