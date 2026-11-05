/**
 * lib/react/config.mjs — the `react` settings (pxsig.config.json, `defaults.react` in
 * pxsig.workspace.json): the off switches, render counting and the compiler analysis.
 *
 * Off, everything React: `react: false` (or "off"), `--no-react` (a config flag: it sets
 * `react: false`), `PXSIG_REACT=off`. `react.compiler`: false (canonical) or "off" turns the
 * compiler analysis off; true or "auto" (the default) runs it when the project has the compiler
 * installed. `react.renders` counts React commits in every render (off by default).
 *
 * A bad value never fails a run (React features only alert): it is one warning line, a doctor
 * finding (`react-config`), and the part it belongs to off for the run: `react.renders` turns
 * render counting off, any other key the compiler analysis, and a `react` that is not an object
 * everything.
 */
/** @import { Project } from '../../types.js' */
/** @import { ReactConfig, ReactSettings } from '../../types/react.js' */

/** The default `react.exclude`: stories, tests, type declarations, vanilla-extract styles. */
export const DEFAULT_EXCLUDE = Object.freeze([
  '**/*.stories.*',
  '**/*.test.*',
  '**/*.spec.*',
  '**/*.d.ts',
  '**/*.css.ts',
  '**/__tests__/**',
  '**/__mocks__/**',
]);
const MODES = ['infer', 'annotation', 'syntax', 'all'];
const TARGETS = ['17', '18', '19', 'auto'];
const KEYS = ['compiler', 'lint', 'compilationMode', 'target', 'environment', 'exclude', 'renders'];
const COMPILER_OFF = 'compiler analysis is off for this run';
const RENDERS_BAD = 'react.renders must be true or false: render counting is off for this run';
const NOT_OBJECT = 'react must be false or an object: React features are off for this run';

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The `react` value, read: why everything is off (an off switch, `react: false` / "off" or
 * `PXSIG_REACT=off`, or a `react` that is not an object), and each part's settings and problems.
 * @param {unknown} raw the merged config's `react`
 * @param {NodeJS.ProcessEnv} env
 * @returns {ReactConfig & { fromConfig: boolean }}
 */
function read(raw, env) {
  /** @type {ReactConfig & { fromConfig: boolean }} */
  const all = {
    off: null,
    fromConfig: false,
    problems: [],
    compiler: false,
    lint: true,
    compilationMode: 'infer',
    target: 'auto',
    environment: {},
    exclude: [...DEFAULT_EXCLUDE],
    renders: false,
  };
  if (['off', 'false', '0'].includes(String(env.PXSIG_REACT ?? '').toLowerCase()))
    return { ...all, off: 'PXSIG_REACT=off' };
  if (raw === false || raw === 'off') return { ...all, off: 'react: false', fromConfig: true };
  const r = raw == null || raw === true ? {} : raw;
  if (!isObj(r)) return { ...all, off: 'a bad react value', problems: [NOT_OBJECT] };
  /** @type {string[]} */
  const bad = [];
  for (const k of Object.keys(r))
    if (!KEYS.includes(k)) bad.push(`react.${k} is not a React setting (${KEYS.join(', ')})`);
  const compiler = r.compiler ?? 'auto';
  if (![true, false, 'auto', 'off'].includes(/** @type {never} */ (compiler)))
    bad.push('react.compiler must be true, false, "auto" or "off"');
  if (r.lint != null && typeof r.lint !== 'boolean') bad.push('react.lint must be true or false');
  const compilationMode = r.compilationMode == null ? 'infer' : r.compilationMode;
  if (typeof compilationMode !== 'string' || !MODES.includes(compilationMode))
    bad.push(`react.compilationMode must be ${MODES.map((m) => `"${m}"`).join(', ')}`);
  const target =
    r.target == null
      ? 'auto'
      : typeof r.target === 'number' || typeof r.target === 'string'
        ? String(r.target)
        : '';
  if (!TARGETS.includes(target)) bad.push('react.target must be "17", "18", "19" or "auto"');
  const environment = r.environment ?? {};
  if (!isObj(environment)) bad.push('react.environment must be an object');
  const exclude = r.exclude ?? [...DEFAULT_EXCLUDE];
  if (!Array.isArray(exclude) || exclude.some((g) => typeof g !== 'string' || !g.trim()))
    bad.push('react.exclude must be an array of globs');
  const rendersBad = r.renders !== undefined && typeof r.renders !== 'boolean';
  const problems = [
    ...(rendersBad ? [RENDERS_BAD] : []),
    ...bad.map((b) => `${b}: ${COMPILER_OFF}`),
  ];
  if (bad.length) return { ...all, problems, renders: r.renders === true };
  return {
    ...all,
    problems,
    compiler: compiler === true || compiler === 'auto',
    lint: r.lint !== false,
    compilationMode: /** @type {ReactConfig['compilationMode']} */ (compilationMode),
    target: /** @type {ReactConfig['target']} */ (target),
    environment: /** @type {Record<string, unknown>} */ (environment),
    exclude: /** @type {string[]} */ (exclude),
    renders: r.renders === true,
  };
}

/** @type {Set<string>} */
const warned = new Set();

/**
 * Render counting's view (lib/capture/render.mjs): whether everything React is off, and
 * `react.renders`. A bad value is one warning line per process.
 * @param {unknown} config the project's merged config (`P.config`)
 * @param {{ env?: NodeJS.ProcessEnv, warn?: (line: string) => void }} [opts]
 * @returns {ReactSettings}
 */
export function reactSettings(config, { env = process.env, warn = (l) => console.error(l) } = {}) {
  const r = read(/** @type {Record<string, unknown> | null | undefined} */ (config)?.react, env);
  for (const line of r.problems.filter((p) => p === RENDERS_BAD || p === NOT_OBJECT))
    if (!warned.has(line)) {
      warned.add(line);
      warn(`[pxsig] ${line}`);
    }
  return { off: r.off, renders: !r.off && r.renders };
}

/**
 * The project's React settings for this run (the compiler analysis, `pxsig react`, doctor).
 * @param {Pick<Project, 'config' | 'configSources'>} P
 * @param {{ flags?: Record<string, unknown>, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {ReactConfig}
 */
export function reactConfig(P, { flags = {}, env = process.env } = {}) {
  const { fromConfig, ...r } = read(P.config.react, env);
  /** @param {string} why */
  const off = (why) => ({ ...r, off: why, compiler: false, renders: false });
  if (flags['no-react'] === true) return off('--no-react');
  if (fromConfig) {
    // `--no-react` is the flags layer's `react: false`.
    const from = P.configSources?.react;
    if (from === 'flags') return off('--no-react');
    return off(
      `react: false in ${from === 'workspace defaults' ? 'pxsig.workspace.json' : 'pxsig.config.json'}`
    );
  }
  return r.off ? off(r.off) : r;
}

/**
 * The warning line for a bad value that turns the compiler analysis off, if there is one.
 * @param {ReactConfig} c
 * @returns {string | null}
 */
export const configWarning = (c) => {
  const p = c.problems.find((x) => x.endsWith(COMPILER_OFF) || x === NOT_OBJECT);
  return p ? `[pxsig] ${p}` : null;
};
