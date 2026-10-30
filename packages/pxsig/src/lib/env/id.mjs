/** The environment's id (env.mjs): the format versions and the hash over the major fields. */
import { createHash } from 'node:crypto';
/** @import { EnvFields, EnvRecord } from '../../types.js' */

export const ENV_VERSION = 1;

/**
 * Bumped when capture code changes what a render looks like (the freeze stylesheet, the waits,
 * the screenshot options): baselines from an older pipeline then compare as `mismatch`.
 */
export const CAPTURE_PIPELINE = 1;

/** @param {string} s */
export const sha = (s) => createHash('sha256').update(s).digest('hex');
/** @param {string | null | undefined} v a version */
export const major = (v) => String(v ?? '').split('.')[0];

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
