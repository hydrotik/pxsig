/**
 * lib/text/config.mjs — the `text` settings (pxsig.config.json, `defaults.text` in
 * pxsig.workspace.json): whether a capture writes its text record (lib/capture/boxes.mjs), and the
 * selectors whose text is never recorded.
 *
 *   text: true | false | "off" | { ignore: ["<selector>", …] }
 *
 * Off: `text: false` (or "off"), `--no-text` (a config flag: it sets `text: false`),
 * `PXSIG_TEXT=off`. Labels only: text capture never changes a render, a gate or an exit code. A bad
 * `text` or `text.ignore` is one warning line and text capture off for the run (an ignore list
 * that cannot be read must not record what it was meant to leave out), never a failed check; a key
 * this version does not know is a warning and ignored.
 */
import { warnOnce } from '../react/config.mjs';
/** @import { Project } from '../../types.js' */
/** @import { TextSettings } from '../../types/text.js' */

/** Text capture when the config does not say: off in this version (owner decision pending). */
export const TEXT_DEFAULT = false;
const KEYS = ['ignore'];
const OFF = 'text capture is off for this run';

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The `text` value, read.
 * @param {unknown} raw the merged config's `text`
 * @param {NodeJS.ProcessEnv} env
 * @returns {TextSettings}
 */
export function readText(raw, env = process.env) {
  /** @type {TextSettings} */
  const off = { on: false, off: null, ignore: [], problems: [] };
  if (['off', 'false', '0'].includes(String(env.PXSIG_TEXT ?? '').toLowerCase()))
    return { ...off, off: 'PXSIG_TEXT=off' };
  if (raw === false || raw === 'off') return { ...off, off: 'text: false' };
  if (raw == null) return TEXT_DEFAULT ? { ...off, on: true } : { ...off, off: 'off by default' };
  if (raw === true) return { ...off, on: true };
  if (!isObj(raw))
    return {
      ...off,
      off: 'a bad text value',
      problems: [`text must be true, false or an object: ${OFF}`],
    };
  const problems = Object.keys(raw)
    .filter((k) => !KEYS.includes(k))
    .map((k) => `text.${k} is not a text setting (${KEYS.join(', ')}): ignored`);
  const ignore = raw.ignore ?? [];
  if (!Array.isArray(ignore) || ignore.some((s) => typeof s !== 'string' || !s.trim()))
    return {
      ...off,
      off: 'a bad text.ignore',
      problems: [...problems, `text.ignore must be an array of selectors: ${OFF}`],
    };
  return { on: true, off: null, ignore: /** @type {string[]} */ (ignore), problems };
}

/**
 * The text settings a capture uses: the project's merged config (`P.config`) and the environment.
 * Each bad value is one warning line per process.
 * @param {unknown} config
 * @param {{ env?: NodeJS.ProcessEnv, warn?: (line: string) => void }} [opts]
 * @returns {TextSettings}
 */
export function textSettings(config, { env = process.env, warn = (l) => console.error(l) } = {}) {
  const t = readText(/** @type {{ text?: unknown } | null | undefined} */ (config)?.text, env);
  for (const line of t.problems) warnOnce(line, warn);
  return t;
}

/**
 * The text settings with where an off switch came from (`pxsig doctor`): `--no-text` is the flags
 * layer's `text: false`, and a config's names its file.
 * @param {Pick<Project, 'config' | 'configSources'>} P
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {TextSettings}
 */
export function textConfig(P, { env = process.env } = {}) {
  const t = readText(P.config.text, env);
  if (t.off !== 'text: false') return t;
  const from = P.configSources?.text;
  return {
    ...t,
    off:
      from === 'flags'
        ? '--no-text'
        : `text: false in ${from === 'workspace defaults' ? 'pxsig.workspace.json' : 'pxsig.config.json'}`,
  };
}
