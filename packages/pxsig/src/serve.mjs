#!/usr/bin/env node
/**
 * serve.mjs — the pxsig server (`pxsig serve`): dashboard, live data, review, on-demand checks,
 * for every project in the workspace.
 *
 *   pxsig serve [--port 6070] [--no-open] [--tab stories] [--watch] [--project a,b] [--debug]
 *
 * - One server per workspace. It writes `node_modules/.cache/pxsig/server.json` (url, pid,
 *   projects) so the CLI, the MCP server and the Storybook addon find it without a fixed port.
 * - Serves the prebuilt dashboard; `/__pxsig/data?project=` is one project's live report and
 *   `/__pxsig/events` (SSE) tells pages when a producer rewrote a report.
 * - Keeps one Rust engine (`pxsig serve`, stdio JSON-RPC) and a warm browser pool for every
 *   project, so approving a baseline or re-checking a story costs one render.
 * - `--watch`: edits under a project's srcRoot re-check only the affected entries.
 * - `--debug`: every program the server starts is printed on stderr (lib/spawn.mjs).
 * - Opening the dashboard: macOS reuses or opens a tab, Linux runs xdg-open, Windows starts
 *   nothing (the link is printed; the terminal makes it clickable).
 *
 * Routes: serve/routes.mjs, one line each; docs/server.md is the reference. The server itself is
 * serve/create.mjs (`createPxsigServer`); this file reads the flags, picks the dashboard, and owns
 * the signals and the exit codes.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, strFlag } from './lib/args.mjs';
import { chooseDashboard } from './lib/dashboard-dir.mjs';
import { findWorkspace, PXSIG_VERSION } from './lib/workspace.mjs';
import { prebuiltDashboardDir, uiContractVersion, useDashboard } from './report.mjs';
import { createPxsigServer, StartError } from './serve/create.mjs';
/** @import { Workspace } from './types.js' */

const here = dirname(fileURLToPath(import.meta.url));

/** @param {string[]} argv */
async function main(argv) {
  const { flags } = parseArgs(argv);
  // Children inherit it, so the engine and checks the server starts are printed too.
  if (flags.debug)
    process.env.PXSIG_DEBUG = [process.env.PXSIG_DEBUG, 'spawn'].filter(Boolean).join(',');
  /** @param {string} k */
  const str = (k) => strFlag(flags, k);
  /** @type {Workspace} */
  let ws;
  try {
    ws = findWorkspace({ workspace: str('workspace') });
  } catch (e) {
    // findWorkspace throws Errors (a missing or malformed workspace file).
    console.error(`[serve] ${/** @type {Error} */ (e).message}`);
    process.exit(2);
  }
  const wantPort = Number(flags.port) || ws.server?.port || 6070;
  const only = str('project')?.split(',');

  // The dashboard: PXSIG_DASHBOARD_DIR, else a project's own build for its UI adapter (dashboard.ui)
  // when it is current, else the prebuilt one. Serve never builds: it says which command does.
  {
    /** @param {string} name */
    const builtinDir = (name) => {
      for (const d of [join(here, '..', 'dashboard'), join(here, '..', '..', 'dashboard')])
        if (existsSync(join(d, 'src', 'ui', 'adapters', name)))
          return join(d, 'src', 'ui', 'adapters', name);
      return null;
    };
    // This pxsig's UI contract version, from the lock shipped with the dashboard source.
    const contract = uiContractVersion();
    const dash = chooseDashboard({
      projects: ws.projects.filter((p) => !only || only.includes(p.name)),
      prebuilt: prebuiltDashboardDir,
      version: PXSIG_VERSION,
      contract,
      root: ws.root,
      builtinDir,
    });
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- not a React hook: it selects the dashboard folder to serve.
    useDashboard(dash.dir);
    if (dash.note) console.log(`[serve] ${dash.note}`);
  }

  /** @type {ReturnType<typeof createPxsigServer>} */
  let app;
  /**
   * No project opened, or no port bound: the message, exit 2. Anything else is a crash, as ever.
   * @param {unknown} e
   * @returns {never}
   */
  function cannotStart(e) {
    if (!(e instanceof StartError)) throw e;
    console.error(`[serve] ${e.message}`);
    process.exit(2);
  }
  try {
    app = createPxsigServer({
      ws,
      flags,
      only,
      port: wantPort,
      watch: !!flags.watch,
      tab: flags.tab ?? null,
      open: !flags['no-open'],
    });
  } catch (e) {
    cannotStart(e);
  }
  const shutdown = async () => {
    await app.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Ctrl+Break in a Windows console (Ctrl+C arrives as SIGINT there too).
  process.on('SIGBREAK', shutdown);
  await app.start().catch(cannotStart);
}

await main(process.argv.slice(2));
