/** Collecting the environment (env.mjs): Node facts plus one probe page per browser. */
import { existsSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import { spawnSync } from '../spawn.mjs';
import { CAPTURE_PIPELINE, canonical, ENV_VERSION, envId, sha } from './id.mjs';
/** @import { EnvBrowser, EnvFields, EnvProbe, EnvRecord, RemoteBrowser } from '../../types.js' */

/** Families every font probe measures; `env.fontProbe` adds more (the design system's). */
export const PROBE_FAMILIES = ['serif', 'sans-serif', 'monospace', 'system-ui'];
const PROBE_TEXT = 'Hamburgefonstiv 0123456789 ÅÉß —→';
const PROBE_SIZES = [12, 16, 32];

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
  // A new canvas's first getContext('2d') gives a context in every browser Playwright drives.
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  /** @type {Record<string, number[]>} */
  const widths = {};
  for (const f of families) {
    widths[f] = sizes.map((px) => {
      g.font = `${px}px ${/[\s,]/.test(f) && !/^["']/.test(f) ? JSON.stringify(f) : f}`;
      return Math.round(g.measureText(text).width * 1000) / 1000;
    });
  }
  /** @type {string | null} */
  let renderer = null;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      // Both parameters are a string (WebGL, WEBGL_debug_renderer_info).
      renderer =
        /** @type {string | null} */ (
          ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
        ) ?? '';
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
 * @param {{ type?: string, channel?: string | null, launchArgs?: string[], fontProbe?: string[], playwright?: string | null, axe?: string | null, pxsig?: string | null, engine?: string | null, remote?: RemoteBrowser | null, env?: NodeJS.ProcessEnv }} [opts]
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
    axe = null,
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
    axe,
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
