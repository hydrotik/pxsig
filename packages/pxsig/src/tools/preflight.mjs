/**
 * tools/preflight.mjs — what `pxsig doctor` and `pxsig_doctor` report before a manifest exists:
 * the facts pxsig already resolves, so a fresh install shows what it will run with.
 *
 * No network request and no process start beyond `pxsig --version`'s own (the engine's
 * `--version`, once per binary). Chromium is a stat of Playwright's `executablePath()`: no launch.
 * The Storybook URL and `staticDir` are the config's; nothing is fetched.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { engineVersion, resolvePeer } from '../lib/workspace.mjs';
import { playwrightVersion } from '../lib/env.mjs';
import { detectAgent } from '../lib/agents.mjs';
import { relPath, toPosix } from '../lib/paths.mjs';

/** @import { ProjectContext } from './context.mjs' */

/**
 * A path as the preflight prints it: workspace-relative inside the workspace, else absolute.
 * @param {string} root
 * @param {string} p
 */
const show = (root, p) => {
  const rel = relative(root, p);
  return rel && !rel.startsWith('..') && !/^[A-Za-z]:|^[\\/]/.test(rel)
    ? relPath(root, p)
    : toPosix(p);
};

/**
 * The setup preflight for one project.
 * @param {ProjectContext} C
 */
export async function preflight(C) {
  const { P, root } = C;
  const bin = P.rustBin;
  const present = existsSync(bin);
  const engine = { path: toPosix(bin), present, version: present ? engineVersion(bin) : null };

  /** @type {{ path: string | null, version: string | null, error?: string }} */
  let playwright = { path: null, version: null };
  /** @type {{ path: string | null, present: boolean, error?: string }} */
  let chromium = { path: null, present: false };
  try {
    const pkg = resolvePeer(P, 'playwright/package.json');
    playwright = { path: show(root, dirname(pkg)), version: playwrightVersion(() => pkg) };
    // The module only: importing Playwright starts nothing; executablePath() reads its registry.
    const mod =
      /** @type {{ chromium?: { executablePath(): string }, default?: { chromium?: { executablePath(): string } } }} */ (
        await import(pathToFileURL(resolvePeer(P, 'playwright')).href)
      );
    const cr = mod.chromium ?? mod.default?.chromium;
    try {
      const exe = cr ? cr.executablePath() : null;
      chromium = { path: exe ? toPosix(exe) : null, present: !!exe && isFile(exe) };
    } catch (e) {
      chromium = { path: null, present: false, error: /** @type {Error} */ (e).message };
    }
  } catch (e) {
    playwright = { ...playwright, error: /** @type {Error} */ (e).message };
  }

  const staticDir = P.storybook.staticDir;
  return {
    engine,
    playwright,
    chromium,
    storybook: {
      url: P.storybook.url,
      staticDir: staticDir ? show(root, staticDir) : null,
      staticDirPresent: staticDir ? existsSync(staticDir) : null,
    },
    agent: detectAgent(),
  };
}

/** @param {string} p */
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** @typedef {Awaited<ReturnType<typeof preflight>>} Preflight */
