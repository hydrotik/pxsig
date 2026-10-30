#!/usr/bin/env node
/**
 * cli.mjs — `pxsig`: the harness from a shell, for people and for agents.
 *
 *   pxsig [command] [args] [--project name | --all] [--workspace dir] [--json | --plain | --markdown | --pretty]
 *         [--storybook-url u] [--storybook-static dir] [--grid n] [--browser ws://…]   (config flags: the top layer)
 *
 *   projects                    the projects in this workspace, with their store and integrity
 *   init [dir] [--name x] [--src src] [--storybook-url url] [--storybook-config dir] [--layout colocated]
 *                               set a package up: pxsig.config.json, its store, the workspace entry
 *                               (colocated: also `*.psig binary diff=psig` in the root .gitattributes)
 *   config                      the resolved config of a project, and which layer set each key
 *   setup [assistant] [--assistant name] [--print]
 *                               the coding assistant's recipe: its MCP entry (the local install, no npx) and
 *                               the instruction not to approve; creates those files only on a yes, only when absent
 *   manifest [--suite x]        rebuild the project's entries from the running Storybook
 *   serve [--watch] [--port n]  the server and dashboard, for every project
 *   mcp                         the MCP server (stdio)
 *   report [--out dir]          a static dashboard for one project
 *   dashboard build [--ui path] [--out dir]
 *                               rebuild the dashboard on this project's design system through a UI adapter
 *                               (--ui, else dashboard.ui in pxsig.config.json; docs/ui/build-adapter.md)
 *   dashboard gaps [--ui path]  what that adapter covers of the UI contract, and what it does not
 *   browser start [--image tag] [--port 3000] | stop | status
 *                               Playwright's browser in the pxsig container image, for --browser <ws>
 *                               (the only commands that start docker; docs/container.md)
 *   snapshot [--out file] [--project a,b]
 *                               a read-only summary of the committed store, for a deployed Storybook
 *                               (the addon writes it into `storybook build`; docs/team.md)
 *   cat <file.psig> [--image out.png]
 *                               a baseline's header (git's textconv for *.psig), or its image
 *   migrate --from <dir> [--apply] [--no-verify]
 *                               move a pre-0.2 store (.baselines + .renders/base) into this project
 *
 *   status                      overview: counts, a11y, most-changed components, server, staleness (default)
 *   stale                       results older than the edits that can change them
 *   list [state] [--component x] [--mode dark] [--limit 30]
 *                               entries by state (problems | changed | error | flaky | drift | pass | a11y | all)
 *   entry <id> [--images baseline,current,diff]
 *                               one entry: verdict, metrics, regions, a11y, and its images
 *   check [ids…] [--changed a.tsx,b.css.ts] [--since main] [--all]
 *                               re-render and re-check (server if up, else in-process); never writes baselines
 *   check --full [--suite x] [--modes a,b] [--update] …
 *                               the full check (src/check.mjs); --update writes baselines (a person only)
 *   affected <files…> | --since <ref>
 *                               which entries those edits can change
 *   a11y [--component x] [--new] [--sarif out.sarif]
 *                               axe violations per entry (--sarif: the new ones as SARIF 2.1.0)
 *   a11y --prune --dry-run [--component x] [--mode m] [--only id,…]
 *                               accepted axe rules a fresh check shows no longer fire (prunable), and why
 *                               the others are not: still fires, stale, not covered
 *   a11y --prune [same filters] [--reason "…"]
 *                               remove the prunable ones (a person at a terminal; typed confirmation)
 *   history [--limit 10]        the last runs
 *   doctor [--component x] [--status code,…] [--ci] [--fail-on error|warn|info] [--offline] [--limit 40]
 *                               integrity per component: unregistered stories, never-checked entries, missing
 *                               baseline images / renders, render errors, stale verdicts, orphans (docs/integrity.md)
 *   doctor --repair [--only register,recheck,restore-baseline-image,convert-legacy] [--apply] [--prune] [--stale]
 *                               the safe repairs: a dry-run plan, or with --apply run them. Never changes a
 *                               signature or approves; --prune (a person at a terminal) moves orphans to trash/;
 *                               --stale also re-checks stale verdicts (left out by default)
 *   approve plan|apply|log|undo|verify
 *                               the guarded bulk approval (src/approve.mjs): plan classifies colour vs shape
 *                               changes and pins render hashes (--new: first baselines); apply is for a
 *                               person at a terminal only
 *
 * Projects: read commands (status, list, stale, a11y, history, doctor) run over every project with
 * --all, and by default when the workspace has several and none is chosen (by --project or the
 * current folder); their rows then carry the project. Every other command needs one project.
 * --workspace (or PXSIG_WORKSPACE) picks the workspace for every command and what they start.
 *
 * Same answers as the MCP server (it runs the same tool code in-process), rendered by lib/term.mjs:
 * a styled terminal view on a TTY, Markdown when piped (Claude Code, Codex, CI), JSON with --json.
 * Exit: 0 ok · 1 problems found (check / stale / doctor) · 2 usage or setup error · 3 needs a person at a terminal.
 * Over several projects, the worst exit wins.
 * Warn mode (lib/enforcement.mjs): `check`, `doctor`, `stale` and `approve verify` take
 * `--enforce[=gate,…]` (anyone) and `--warn[=gate,…]` (a person at a terminal); a gate the committed
 * config sets to warn exits `advisoryExit` (0) where it alone would have failed, and says so. A real
 * failure in another project still beats an advisory exit.
 * Per-entry approve / reject stays in the dashboard and Storybook panel, where a person sees the images.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, unknownFlagLines, unknownFlags } from './lib/args.mjs';
import {
  engineVersion,
  flagLayer,
  PXSIG_VERSION,
  rustBinary,
  setFlagLayer,
} from './lib/workspace.mjs';
import { uiContractVersion } from './report.mjs';
import { pickFormat } from './lib/term.mjs';
import { cliContext } from './cli/context.mjs';
import { readCommands } from './cli/read.mjs';
import { checkCommands } from './cli/check.mjs';
import { projectCommands } from './cli/project.mjs';
import { toolCommands } from './cli/tools.mjs';

// --- args --------------------------------------------------------------------------------------
const { positional, flags } = parseArgs(process.argv.slice(2));
const format = pickFormat(flags);
const [command = 'status', ...rest] = positional;
const CMD = process.env.PXSIG_CMD ?? 'pxsig';
// A misspelled flag is ignored like any other unknown one, so say so on stderr. `cat` passes its
// flags to the engine, which checks them itself.
if (command !== 'cat')
  for (const line of unknownFlagLines(unknownFlags(process.argv.slice(2))))
    process.stderr.write(`${line}\n`);
// `pxsig --version` / `pxsig version`: this CLI, the engine it would run and the UI contract.
if (flags.version === true || command === 'version') {
  let engine = null;
  try {
    engine = engineVersion(rustBinary());
  } catch {
    // no engine for this platform: reported as null / "not found"
  }
  const versions = { pxsig: PXSIG_VERSION, engine, contract: uiContractVersion() };
  process.stdout.write(
    pickFormat(flags) === 'json'
      ? `${JSON.stringify(versions)}\n`
      : `pxsig ${PXSIG_VERSION} (engine ${engine ?? 'not found'}, UI contract ${versions.contract ?? 'unknown'})\n`
  );
  process.exit(0);
}
const here = dirname(fileURLToPath(import.meta.url));
// --workspace applies to everything: this process, the tools it calls and the commands it starts.
if (typeof flags.workspace === 'string') process.env.PXSIG_WORKSPACE = resolve(flags.workspace);
// Config flags (--storybook-url, --grid, …) are the top config layer for every project opened here.
setFlagLayer(flagLayer(flags));
const project =
  typeof flags.project === 'string' ? flags.project : (process.env.PXSIG_PROJECT ?? undefined);

// --- commands ------------------------------------------------------------------------------------
const cli = cliContext({ flags, positional, format, command, rest, CMD, here, project });
const { fail } = cli;
const commands = {
  ...readCommands(cli),
  ...checkCommands(cli),
  ...projectCommands(cli),
  ...toolCommands(cli),
};

if (flags.help || command === '--help') commands.help();
else if (!(/** @type {Record<string, (() => unknown) | undefined>} */ (commands)[command]))
  fail(`unknown command "${command}" — try: ${Object.keys(commands).join(', ')}`);
else
  try {
    // checked on the line above: `command` names one
    await /** @type {Record<string, () => unknown>} */ (commands)[command]();
  } catch (e) {
    // Setup errors (no workspace, no project, unreadable config) and anything unexpected: exit 2.
    fail(/** @type {Error} */ (e).message, 2);
  }
