/**
 * lib/react/config.mjs — the `react` config key (pxsig.config.json, or the workspace file's
 * `defaults`), the off switches, and what a bad value does.
 *
 * Off, everything React: `react: false`, `--no-react`, `PXSIG_REACT=off`. `react.compiler`: false
 * (canonical) or "off" turns the compiler analysis off; true or "auto" (the default) runs it when
 * the project has the compiler installed. A bad value never fails a run (React analysis only
 * alerts): it is one warning line, a doctor finding (`react-config`), and the feature off.
 */
/** @import { Flags, Project } from '../../types.js' */
/** @import { ReactConfig } from '../../types/react.js' */

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

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** @param {string} why */
const off = (why) =>
  /** @type {ReactConfig} */ ({
    off: why,
    problems: [],
    compiler: false,
    lint: false,
    compilationMode: 'infer',
    target: 'auto',
    environment: {},
    exclude: [...DEFAULT_EXCLUDE],
    renders: false,
  });

/**
 * The project's React settings for this run.
 * @param {Pick<Project, 'config' | 'configSources'>} P
 * @param {{ flags?: Flags, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {ReactConfig}
 */
export function reactConfig(P, { flags = {}, env = process.env } = {}) {
  if (flags['no-react'] === true) return off('--no-react');
  if (String(env.PXSIG_REACT ?? '').toLowerCase() === 'off') return off('PXSIG_REACT=off');
  const raw = P.config.react;
  if (raw === false) {
    const where =
      P.configSources?.react === 'workspace defaults'
        ? 'pxsig.workspace.json'
        : 'pxsig.config.json';
    return off(`react: false in ${where}`);
  }
  const r = raw == null || raw === true ? {} : raw;
  if (!isObj(r))
    return {
      ...off('react must be an object, true or false'),
      problems: ['react must be an object, true or false'],
    };
  /** @type {string[]} */
  const problems = [];
  for (const k of Object.keys(r))
    if (!KEYS.includes(k)) problems.push(`react.${k} is not a React setting (${KEYS.join(', ')})`);
  const compiler = r.compiler ?? 'auto';
  if (![true, false, 'auto', 'off'].includes(/** @type {never} */ (compiler)))
    problems.push('react.compiler must be true, false, "auto" or "off"');
  /**
   * @param {string} k
   * @param {boolean} dflt
   */
  const bool = (k, dflt) => {
    if (r[k] == null) return dflt;
    if (typeof r[k] !== 'boolean') problems.push(`react.${k} must be true or false`);
    return r[k] === true;
  };
  const lint = bool('lint', true);
  const renders = bool('renders', false);
  const compilationMode = r.compilationMode ?? 'infer';
  if (!MODES.includes(/** @type {string} */ (compilationMode)))
    problems.push(`react.compilationMode must be ${MODES.map((m) => `"${m}"`).join(', ')}`);
  const target =
    r.target == null
      ? 'auto'
      : typeof r.target === 'number' || typeof r.target === 'string'
        ? String(r.target)
        : '';
  if (!TARGETS.includes(target)) problems.push('react.target must be "17", "18", "19" or "auto"');
  const environment = r.environment ?? {};
  if (!isObj(environment)) problems.push('react.environment must be an object');
  const exclude = r.exclude ?? [...DEFAULT_EXCLUDE];
  if (!Array.isArray(exclude) || exclude.some((g) => typeof g !== 'string' || !g.trim()))
    problems.push('react.exclude must be an array of globs');
  if (problems.length) return { ...off(problems[0]), problems };
  return {
    off: null,
    problems: [],
    compiler: compiler === true || compiler === 'auto',
    lint,
    compilationMode: /** @type {ReactConfig['compilationMode']} */ (compilationMode),
    target: /** @type {ReactConfig['target']} */ (target),
    environment: /** @type {Record<string, unknown>} */ (environment),
    exclude: /** @type {string[]} */ (exclude),
    renders,
  };
}

/**
 * The warning line for a bad `react` value.
 * @param {ReactConfig} c
 * @returns {string | null}
 */
export const configWarning = (c) =>
  c.problems.length ? `[pxsig] ${c.problems[0]}: React analysis is off for this run` : null;
