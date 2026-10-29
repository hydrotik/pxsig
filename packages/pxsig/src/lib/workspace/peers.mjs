/** What pxsig runs beside (workspace.mjs): the engine binary, peer packages, the server's address. */
/** @import { PeerBase } from '../../types.js' */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SetupError } from './core.mjs';

/**
 * The pxsig binary: PXSIG_BIN, else the platform package, else a source checkout's build.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function rustBinary(env = process.env) {
  const exe = process.platform === 'win32' ? 'pxsig.exe' : 'pxsig';
  if (env.PXSIG_BIN) return resolve(env.PXSIG_BIN);
  const req = createRequire(import.meta.url);
  try {
    return req.resolve(`@pxsig/cli-${process.platform}-${process.arch}/bin/${exe}`);
  } catch {
    // no platform package: fall back to a source checkout
  }
  const here = dirname(fileURLToPath(import.meta.url));
  // Only pxsig's own clone has its build there; an installed pxsig would otherwise run a binary
  // from the project that installed it (whatever a pull request put in its target/release).
  // The path returned is where the platform package belongs, so the "binary is missing" error names it.
  if (here.split(sep).includes('node_modules'))
    return resolve(
      here,
      '..',
      '..',
      '..',
      '..',
      '@pxsig',
      `cli-${process.platform}-${process.arch}`,
      'bin',
      exe
    );
  return resolve(here, '..', '..', '..', '..', '..', 'target', 'release', exe);
}

/**
 * Load a peer dependency (playwright, axe-core) the way the project would: from the project, then
 * the workspace root, then pxsig's own install (`PXSIG_PLAYWRIGHT`, when set, comes first for
 * Playwright). Playwright is also found through
 * `@playwright/test`, so renders use the browser build the project already tests with.
 * @param {PeerBase} P
 * @param {string} name
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolvePeer(P, name, env = process.env) {
  // `filter(Boolean)` keeps the folders that are set.
  const bases = /** @type {string[]} */ ([P?.root, P?.workspaceRoot].filter(Boolean));
  /** @type {(() => string)[]} */
  const tries = [];
  // PXSIG_PLAYWRIGHT (the container image sets it): that Playwright package folder first, so the
  // driver always matches the browsers installed beside it. Unset, nothing changes.
  if (env.PXSIG_PLAYWRIGHT && (name === 'playwright' || name.startsWith('playwright/'))) {
    const dir = resolve(env.PXSIG_PLAYWRIGHT);
    tries.push(() =>
      createRequire(join(dir, 'package.json')).resolve(dir + name.slice('playwright'.length))
    );
  }
  for (const base of bases) {
    tries.push(() => createRequire(join(base, 'package.json')).resolve(name));
    if (name === 'playwright' || name.startsWith('playwright/'))
      tries.push(() =>
        createRequire(
          createRequire(join(base, 'package.json')).resolve('@playwright/test/package.json')
        ).resolve(name)
      );
  }
  tries.push(() => createRequire(import.meta.url).resolve(name));
  for (const t of tries) {
    try {
      return t();
    } catch {
      // try the next place
    }
  }
  throw new SetupError(`cannot find "${name}": install it in the workspace (pnpm add -D ${name})`);
}

/**
 * Where the running server writes its address: never committed, never inside a package.
 * @param {string} root
 */
export const serverFile = (root) => join(root, 'node_modules', '.cache', 'pxsig', 'server.json');
/**
 * Where `pxsig browser start` records its container (endpoint, image, digest): beside server.json.
 * @param {string} root
 */
export const browserFile = (root) => join(root, 'node_modules', '.cache', 'pxsig', 'browser.json');

/**
 * The server URL for a workspace: PXSIG_URL, else the running server's file, else the configured port.
 * @param {string} wsRoot
 * @param {{ env?: NodeJS.ProcessEnv, port?: number | null }} [opts]
 * @returns {string}
 */
export function serverUrlFor(wsRoot, { env = process.env, port = null } = {}) {
  if (env.PXSIG_URL) return env.PXSIG_URL.replace(/\/$/, '');
  try {
    // server.json, which `pxsig serve` writes.
    const s = /** @type {{ url?: string }} */ (
      JSON.parse(readFileSync(serverFile(wsRoot), 'utf8'))
    );
    if (s.url) return s.url;
  } catch {
    // no server file: fall through to the configured port
  }
  return `http://127.0.0.1:${port ?? 6070}`;
}
