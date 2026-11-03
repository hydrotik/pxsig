/**
 * tools/preflight.mjs — what `pxsig doctor` and `pxsig_doctor` report before a manifest exists:
 * the facts pxsig already resolves, so a fresh install shows what it will run with.
 *
 * No network request and no process start beyond `pxsig --version`'s own (the engine's
 * `--version`, once per binary). Chromium is a stat of Playwright's `executablePath()`: no launch.
 * The Storybook URL and `staticDir` are the config's; nothing is fetched.
 *
 * No absolute path (it names the user): each path is workspace-relative, or a label outside the
 * workspace. `pxsig config --json` has the engine's absolute path.
 */
import { existsSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { engineVersion, resolvePeer } from '../lib/workspace.mjs';
import { playwrightVersion } from '../lib/env.mjs';
import { detectAgent } from '../lib/agents.mjs';
import { insidePath } from '../lib/paths.mjs';

/** @import { ProjectContext } from './context.mjs' */

/**
 * A path as the preflight shows it: workspace-relative inside the workspace, else `label`.
 * @param {string} root
 * @param {string} p
 * @param {string} label
 */
const show = (root, p, label) => insidePath(root, p) ?? label;

/**
 * The engine outside the workspace: where it came from, by name.
 * @param {string} bin
 */
const engineLabel = (bin) => {
  if (process.env.PXSIG_BIN) return `PXSIG_BIN (${basename(bin)})`;
  const pkg = /@pxsig[\\/](cli-[^\\/]+)/.exec(bin)?.[1];
  return pkg ? `bundled (@pxsig/${pkg})` : 'built from source';
};

/**
 * The setup preflight for one project.
 * @param {ProjectContext} C
 */
export async function preflight(C) {
  const { P, root } = C;
  const bin = P.rustBin;
  const present = existsSync(bin);
  const engine = {
    path: show(root, bin, engineLabel(bin)),
    present,
    version: present ? engineVersion(bin) : null,
  };

  /** @type {{ path: string | null, version: string | null, error?: string }} */
  let playwright = { path: null, version: null };
  /** @type {{ path: string | null, present: boolean, error?: string }} */
  let chromium = { path: null, present: false };
  try {
    const pkg = resolvePeer(P, 'playwright/package.json');
    playwright = {
      path: show(root, dirname(pkg), 'outside the workspace'),
      version: playwrightVersion(() => pkg),
    };
    // The module only: importing Playwright starts nothing; executablePath() reads its registry.
    const mod =
      /** @type {{ chromium?: { executablePath(): string }, default?: { chromium?: { executablePath(): string } } }} */ (
        await import(pathToFileURL(resolvePeer(P, 'playwright')).href)
      );
    const cr = mod.chromium ?? mod.default?.chromium;
    try {
      const exe = cr ? cr.executablePath() : null;
      chromium = {
        path: exe ? show(root, exe, "Playwright's Chromium") : null,
        present: !!exe && isFile(exe),
      };
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
      staticDir: staticDir ? show(root, staticDir, basename(staticDir)) : null,
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
