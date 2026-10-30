/** Playwright and the browsers it drives (capture.mjs): launch, connect, the record, the pool. */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { browserFile, resolvePeer, SetupError } from '../workspace.mjs';
import { collectEnv, playwrightVersion } from '../env.mjs';
/** @import { EnvRecord, PeerBase, Project } from '../../types.js' */
/** @import { BrowserName, BrowserRecordFile, PlaywrightLib, PxsigBrowser } from '../../types/t4.js' */

/**
 * Playwright, resolved the way the project would resolve it (see lib/workspace.mjs).
 * @param {PeerBase} project
 * @returns {Promise<PlaywrightLib>}
 */
async function playwright(project) {
  // The playwright module: its engines at the top, or under `default` (CommonJS interop).
  const pw = /** @type {PlaywrightLib & { default: PlaywrightLib }} */ (
    await import(pathToFileURL(resolvePeer(project, 'playwright')).href)
  );
  return pw.chromium ? pw : pw.default;
}

/**
 * Launch Chromium from the project's Playwright: the given channel, else the bundled build, then
 * Chrome, then Edge.
 * @param {PeerBase} project
 * @param {string} [channel]
 * @returns {Promise<PxsigBrowser>}
 */
export async function launchBrowser(project, channel) {
  const chromium = (await playwright(project)).chromium;
  let lastErr;
  for (const ch of channel ? [channel] : [undefined, 'chrome', 'msedge']) {
    try {
      // A Browser; the keys pxsig adds are optional.
      const b = /** @type {PxsigBrowser} */ (await chromium.launch(ch ? { channel: ch } : {}));
      // The channel it launched with is part of the render environment (lib/env.mjs).
      b.__pxsigChannel = ch ?? null;
      return b;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * Connect to a Playwright browser server (`pxsig browser start`, `playwright run-server`) instead of
 * launching. One endpoint serves every engine, picked by the `x-playwright-browser` header;
 * `exposeNetwork: '<loopback>'` lets that browser reach this machine's localhost (Storybook).
 * @param {PlaywrightLib} pw
 * @param {string} endpoint
 * @param {BrowserName} [type]
 * @returns {Promise<PxsigBrowser>}
 */
export async function connectBrowser(pw, endpoint, type = 'chromium') {
  try {
    // A Browser; the keys pxsig adds are optional.
    const b = /** @type {PxsigBrowser} */ (
      await pw[type].connect(endpoint, {
        exposeNetwork: '<loopback>',
        headers: { 'x-playwright-browser': type },
      })
    );
    b.__pxsigRemote = endpoint;
    return b;
  } catch (e) {
    const why = String(/** @type {Error | undefined} */ (e)?.message ?? e).split('\n')[0];
    throw new SetupError(
      `cannot use the browser server at ${endpoint} (${type}): ${why}. Is it running (pxsig browser status), and is this project's Playwright the server's major.minor?`
    );
  }
}

/**
 * What `pxsig browser start` recorded for `endpoint` (image, digest), or null.
 * @param {PeerBase} project
 * @param {string} endpoint
 * @returns {BrowserRecordFile | null}
 */
export function browserRecord(project, endpoint) {
  const f = project?.workspaceRoot ? browserFile(project.workspaceRoot) : null;
  try {
    // browser.json, as `pxsig browser start` wrote it.
    const r =
      f && existsSync(f)
        ? /** @type {BrowserRecordFile | null} */ (JSON.parse(readFileSync(f, 'utf8')))
        : null;
    return r && r.ws === endpoint ? r : null;
  } catch {
    return null;
  }
}

/**
 * Lazily launch one browser per engine (`chromium` | `firefox` | `webkit`), shared by the pool.
 * `env(type)` is that browser's render environment (lib/env.mjs), collected once per launch.
 * With `endpoint` (`capture.browserEndpoint`, `--browser`, `PXSIG_BROWSER_WS`) every engine is
 * connected to that browser server instead; without it, launching is exactly as before.
 * @param {Project | null} project
 * @param {Record<string, PxsigBrowser>} [given]
 * @param {{ endpoint?: string | null, pw?: PlaywrightLib | null }} [opts]
 */
export function browserPool(
  project,
  given = {},
  { endpoint = project?.config?.capture?.browserEndpoint ?? null, pw = null } = {}
) {
  const open = new Map(Object.entries(given).map(([k, b]) => [k, Promise.resolve(b)]));
  /** @type {Map<string, Promise<EnvRecord>>} */
  const envs = new Map();
  const lib = () => (pw ? Promise.resolve(pw) : playwright(project));
  return {
    endpoint,
    /**
     * @param {string} [type]
     * @param {Parameters<typeof collectEnv>[1]} [opts]
     * @returns {Promise<EnvRecord>}
     */
    env(type = 'chromium', opts = {}) {
      if (!envs.has(type))
        envs.set(
          type,
          this.get(type).then((b) =>
            collectEnv(b, {
              type,
              channel: b.__pxsigChannel ?? null,
              playwright: project
                ? playwrightVersion(() => resolvePeer(project, 'playwright/package.json'))
                : null,
              remote: b.__pxsigRemote
                ? { endpoint: b.__pxsigRemote, record: browserRecord(project, b.__pxsigRemote) }
                : null,
              ...opts,
            })
          )
        );
      // Set just above when it was missing.
      return /** @type {Promise<EnvRecord>} */ (envs.get(type));
    },
    /**
     * The environments of every browser type in `types`: `{ chromium: env, … }`.
     * @param {Iterable<string>} types
     * @param {Parameters<typeof collectEnv>[1]} [opts]
     * @returns {Promise<Record<string, EnvRecord>>}
     */
    async envs(types, opts = {}) {
      /** @type {Record<string, EnvRecord>} */
      const out = {};
      for (const t of new Set(types)) out[t] = await this.env(t, opts);
      return out;
    },
    /**
     * `type` is an engine name: a manifest's `browser` (schema `$defs/mode`) or the default.
     * @param {string} [type]
     * @returns {Promise<PxsigBrowser>}
     */
    get(type = 'chromium') {
      if (!open.has(type))
        open.set(
          type,
          endpoint
            ? lib().then((p) => connectBrowser(p, endpoint, /** @type {BrowserName} */ (type)))
            : type === 'chromium'
              ? launchBrowser(project)
              : lib().then((p) => p[/** @type {BrowserName} */ (type)].launch())
        );
      // Set just above when it was missing.
      return /** @type {Promise<PxsigBrowser>} */ (open.get(type));
    },
    async close() {
      for (const [k, b] of open) if (!(k in given)) await (await b).close().catch(() => {});
    },
  };
}
