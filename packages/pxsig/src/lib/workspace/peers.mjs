/** What pxsig runs beside (workspace.mjs): the engine binary, peer packages, the server's address. */
/** @import { PeerBase } from '../../types.js' */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
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
 * Load a peer dependency (playwright; axe-core only when pxsig's own is missing, capture/page.mjs)
 * the way the project would: from the project, then the workspace root, then pxsig's own install
 * (`PXSIG_PLAYWRIGHT`, when set, comes first for Playwright). Playwright is also found through
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
  const pkg = name
    .split('/')
    .slice(0, name.startsWith('@') ? 2 : 1)
    .join('/');
  throw new SetupError(
    `cannot find "${pkg}": install it in the workspace (${addCommand(bases, pkg)})`
  );
}

/** Lockfile → the command that adds a dev dependency with that package manager. */
const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm add -D'],
  ['yarn.lock', 'yarn add -D'],
  ['bun.lock', 'bun add -d'],
  ['bun.lockb', 'bun add -d'],
  ['package-lock.json', 'npm install -D'],
];

/**
 * The command that adds `pkg` as a dev dependency, for the package manager whose lockfile is in the
 * first of `dirs` that has one (a file check, nothing run); npm without a lockfile.
 * @param {string[]} dirs
 * @param {string} pkg
 * @returns {string}
 */
export function addCommand(dirs, pkg) {
  for (const dir of dirs)
    for (const [file, cmd] of LOCKFILES) if (existsSync(join(dir, file))) return `${cmd} ${pkg}`;
  return `npm install -D ${pkg}`;
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

/** @type {Map<string, string>} */
const ids = new Map();
/**
 * A workspace's id: the first 16 hex characters of the SHA-256 of its real path. The server's
 * status answer carries it (`workspaceId`) so a client can tell its own workspace's server from
 * another's on the same port, without the path (a user name) leaving the process.
 * @param {string} root
 * @returns {string}
 */
export function workspaceId(root) {
  let id = ids.get(root);
  if (!id) {
    let real = resolve(root);
    try {
      real = realpathSync(real);
    } catch {
      // a folder that is gone: its resolved path
    }
    id = createHash('sha256').update(real).digest('hex').slice(0, 16);
    ids.set(root, id);
  }
  return id;
}

/** @type {Set<string>} */
const warned = new Set();
/**
 * Whether the server that answered `status` at `url` may act for the workspace at `root`: null
 * when it may, else why not. A server that names another workspace is refused, and so is one that
 * names none (pxsig 0.6 or earlier) at the default address, where any workspace's server may be
 * listening. PXSIG_URL is the person's choice: a mismatch there is one warning line on stderr.
 * @param {{ workspaceId?: unknown } | null | undefined} status GET /__pxsig/status's answer
 * @param {{ root: string, url: string, env?: NodeJS.ProcessEnv }} at
 * @returns {string | null}
 */
export function foreignServer(status, { root, url, env = process.env }) {
  const id = status?.workspaceId;
  if (id === workspaceId(root)) return null;
  let recorded = null;
  try {
    // server.json, which `pxsig serve` writes for this workspace.
    recorded = /** @type {{ url?: string }} */ (JSON.parse(readFileSync(serverFile(root), 'utf8')))
      .url;
  } catch {
    // no server file
  }
  if (id == null && (env.PXSIG_URL || recorded === url)) return null;
  const why = `the pxsig server at ${url} ${id == null ? 'does not say which workspace it serves (pxsig 0.6 or earlier)' : 'serves another workspace'}`;
  if (env.PXSIG_URL) {
    if (!warned.has(url)) process.stderr.write(`pxsig: warning: ${why} (PXSIG_URL)\n`);
    warned.add(url);
    return null;
  }
  return `${why}: start \`pxsig serve\` in this workspace, or set PXSIG_URL to its address`;
}
