/**
 * env-helpers.mjs — what env.test.mjs and env-check.test.mjs share: the src path, a complete env
 * record, a Playwright Browser stand-in and the Rust and Chromium probe.
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envId } from '../src/lib/env.mjs';
import { hasRust } from './fixture.mjs';
import { skipUnless } from './strict.mjs';
/** @import { EnvBrowser, EnvFields, EnvRecord } from '../src/types.js' */

export const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * A complete env, as collectEnv writes one; `over` replaces parts.
 * @param {Record<string, unknown>} [over]
 * @returns {EnvRecord}
 */
export function env(over = {}) {
  /** @type {EnvFields & Record<string, unknown>} */
  const e = {
    v: 1,
    browser: { name: 'chromium', version: '141.0.7390.37', channel: null, launchArgs: [] },
    playwright: '1.58.2',
    os: { platform: 'linux', arch: 'x64', release: '6.8.0', distro: 'Ubuntu 24.04 LTS' },
    fonts: {
      probe: {
        digest: 'd1',
        families: {
          serif: 'aaaaaaaa',
          'sans-serif': 'bbbbbbbb',
          monospace: 'cccccccc',
          'system-ui': 'dddddddd',
        },
      },
      system: 'f1',
    },
    render: {
      dpr: 1,
      gpu: 'swiftshader',
      colorGamut: 'srgb',
      timezone: 'UTC',
      locale: 'en-US',
      reducedMotion: 'reduce',
    },
    capture: { pipeline: 1 },
    container: null,
    pxsig: '0.5.0',
    engine: '0.5.0',
    node: 'v22.18.0',
  };
  for (const [k, v] of Object.entries(over))
    e[k] =
      v && typeof v === 'object' && !Array.isArray(v) && e[k] && typeof e[k] === 'object'
        ? { ...e[k], ...v }
        : v;
  // The defaults are a complete env and `over` replaces parts of it with parts of the same shape.
  e.id = envId(e);
  return /** @type {EnvRecord} */ (e);
}

/**
 * A Playwright Browser stand-in: the probe page answers with fixed facts.
 * @param {{ renderer?: string }} [opts]
 */
export function stubBrowser({
  renderer = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)',
} = {}) {
  let closed = 0;
  const page = {
    setContent: async () => {},
    /**
     * collectEnv evaluates PROBE_PAGE with its `{ families, text, sizes }`.
     * @template A
     * @param {(arg: A) => unknown} fn
     * @param {A & { families?: string[] }} [arg]
     */
    evaluate: async (fn, arg) =>
      arg?.families
        ? {
            widths: Object.fromEntries(arg.families.map((f) => [f, [10, 13.333, 26.667]])),
            renderer,
            colorGamut: 'p3',
            timezone: 'Europe/London',
            locale: 'en-GB',
          }
        : null,
  };
  return {
    version: () => '141.0.7390.37',
    browserType: () => ({ name: () => 'chromium' }),
    /** @param {Parameters<EnvBrowser['newContext']>[0]} opts */
    newContext: async (opts) => {
      assert.equal(opts.deviceScaleFactor, 1);
      assert.equal(opts.reducedMotion, 'reduce');
      return { newPage: async () => page, close: async () => closed++ };
    },
    closed: () => closed,
  };
}

let chromium = false;
try {
  const pw = await import('playwright');
  await (await pw.chromium.launch()).close();
  chromium = true;
} catch {
  chromium = false;
}
export const needs =
  skipUnless(hasRust, 'Rust binary not built') || skipUnless(chromium, 'no Chromium');
