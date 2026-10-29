/** Versions (workspace.mjs): this pxsig's, the container image's, the engine binary's. */
/** @import { ImageTag, PackageJson, PeerBase, SetupProblem } from '../../types.js' */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from '../spawn.mjs';
import { resolvePeer } from './peers.mjs';

/**
 * The version of this pxsig install.
 * @type {string}
 */
export const PXSIG_VERSION = /** @type {{ version: string }} */ (
  // pxsig's own package.json, which always has a version.
  JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))
).version;

/**
 * `ghcr.io/hydrotik/pxsig:0.5.0-pw1.58.2[-r2][-amd64]` → { pxsig, playwright }, or null.
 * @param {string | null | undefined} image
 * @returns {ImageTag | null}
 */
export function parseImageTag(image) {
  const m = String(image ?? '').match(
    /:(\d+\.\d+\.\d+(?:-[\w.]+?)?)-pw(\d+\.\d+\.\d+)(?:-r\d+)?(?:-(?:amd64|arm64))?(?:@|$)/
  );
  return m ? { pxsig: m[1], playwright: m[2] } : null;
}

/**
 * Inside the container image (`PXSIG_IMAGE` set): the image's pxsig and Playwright should be the
 * ones the project pins, or its renders are not the ones the project's own install would make.
 * @param {PeerBase} P
 * @param {string | null | undefined} wsRoot
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {SetupProblem[]}
 */
export function imageProblems(P, wsRoot, env = process.env) {
  const tag = parseImageTag(env.PXSIG_IMAGE);
  if (!tag) return [];
  /** @type {SetupProblem[]} */
  const out = [];
  /** @param {string} pj */
  const version = (pj) => {
    try {
      return /** @type {PackageJson} */ (JSON.parse(readFileSync(pj, 'utf8'))).version ?? null;
    } catch {
      return null;
    }
  };
  let pw = null;
  try {
    pw = version(resolvePeer(P, 'playwright/package.json', env));
  } catch {
    // no Playwright resolves: the check itself says so
  }
  if (pw && pw !== tag.playwright)
    out.push({
      code: 'image-mismatch',
      severity: 'warn',
      reason: `the image ${env.PXSIG_IMAGE} is built for Playwright ${tag.playwright}, but Playwright ${pw} resolves here: renders use browsers that do not match the driver. Use the image tag for ${pw}, or set PXSIG_PLAYWRIGHT to the image's own`,
    });
  const pinned = wsRoot ? version(join(wsRoot, 'node_modules', 'pxsig', 'package.json')) : null;
  if (pinned && pinned !== tag.pxsig)
    out.push({
      code: 'image-mismatch',
      severity: 'warn',
      reason: `the image ${env.PXSIG_IMAGE} runs pxsig ${tag.pxsig}, but this project pins pxsig ${pinned}: use the image tag for ${pinned}`,
    });
  return out;
}

/** @type {Map<string, string | null>} */
const engineVersions = new Map();
/**
 * The engine binary's version (`pxsig --version`), once per binary and build; null when it does not run.
 * @param {string} bin
 * @returns {string | null}
 */
export function engineVersion(bin) {
  let key;
  try {
    key = `${bin}|${statSync(bin).mtimeMs}`;
  } catch {
    return null;
  }
  if (!engineVersions.has(key)) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    engineVersions.set(key, (String(r.stdout ?? '').match(/(\d+\.\d+\.\d+\S*)/) ?? [])[1] ?? null);
  }
  // Set just above when it was missing.
  return /** @type {string | null} */ (engineVersions.get(key));
}

/**
 * An engine binary older than this CLI (a stale `PXSIG_BIN`, a platform package left behind): it
 * ignores the render environment the CLI sends, so the baselines it writes carry no `env`.
 * @param {string | null | undefined} bin
 * @returns {SetupProblem[]}
 */
export function engineProblems(bin) {
  if (!bin || !existsSync(bin)) return [];
  const v = engineVersion(bin);
  if (!v) return [];
  /** @param {unknown} x */
  const mm = (x) => String(x).split('.').slice(0, 2).map(Number);
  const [a, b] = mm(v);
  const [c, d] = mm(PXSIG_VERSION);
  if (a > c || (a === c && b >= d)) return [];
  return [
    {
      code: 'engine-old',
      severity: 'warn',
      reason: `the engine binary is pxsig ${v}, older than this pxsig ${PXSIG_VERSION}: baselines it writes carry no render environment (env), and other newer engine features are missing. Install the matching @pxsig/cli package (or unset PXSIG_BIN)`,
    },
  ];
}
