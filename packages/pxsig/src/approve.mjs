/**
 * approve.mjs — the guarded way to accept new baselines in bulk (`pxsig approve …`).
 *
 *   plan  <ids…> | --component x | --all-changed | --new   --reason "why"
 *         [--allow-shape id,id] [--first-baselines]
 *         Classifies each changed entry (lib/shape.mjs): `colour` (content in place) or `shape`
 *         (moved / added / removed / resized). Shape entries are BLOCKED unless named in
 *         --allow-shape; stale verdicts are blocked. `--new` plans NEW entries (no baseline yet,
 *         with a latest render): with nothing to compare they are shape changes, so each needs
 *         --allow-shape, or --first-baselines for all of them. Pins the sha256 of every latest
 *         render and baseline. Writes <store>/reports/approval-plan.json. Safe for anyone, agents included.
 *   apply [plan]
 *         A person at a real terminal only (refused when piped, in CI or under an assistant). Re-hashes
 *         every render and refuses the whole plan if one changed since planning, then asks for the
 *         phrase "APPROVE <n> ENTRIES". Each write is snapshotted and logged by the server.
 *   log [--limit 10] [--trace]
 *                         approvals by batch; --trace adds the commit that added each batch's lines
 *                         and the pull request that merged it (from git; never a name)
 *   undo <batch>          restore a batch's previous baselines (terminal only, typed confirm); from
 *                         the local snapshot, else from git (only bytes matching the logged sha256)
 *   verify [--no-strict] [--since <ref>] [--suite <name> | --all-suites] [--adopt]
 *                         baselines whose bytes differ from their last logged approval, and (strict,
 *                         the default) baselines with no log line at all; --since also fails when the
 *                         log was rewritten rather than appended to; --adopt logs the current
 *                         baselines as the starting point (terminal only). Under warn mode
 *                         (the `verify` gate) only baselines with no log line are warned; a
 *                         mismatch or a rewritten log fails in every mode
 *
 * Per-entry approval in the dashboard / Storybook panel stays as it is (one entry, images on
 * screen) and is logged the same way.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCommand, planCommand } from './approve/plan.mjs';
import { logCommand, undoCommand } from './approve/log.mjs';
import { verifyCommand } from './approve/verify.mjs';
import { humanAtTerminal, whyNotPerson } from './lib/term.mjs';
import { relPath } from './lib/paths.mjs';
/** @import { Flags, Manifest, ManifestEntry, Project } from './types.js' */

/** What this file reads of each MCP tool's result, by tool. */
/** @typedef {{ list: { entries: { id: string, state: string }[] }, stale: { ids: string[] }, check: unknown }} ToolOutputs */
/**
 * What approveCommand hands each subcommand (src/approve/): the CLI's context, the manifest, and
 * the helpers they share.
 * @typedef {{ args: string[], flags: Flags, format: string, P: Project, serverUrl: string, CMD: string, fail: (message: string, code?: number) => never, run: <N extends keyof ToolOutputs>(name: N, a?: Record<string, unknown>) => Promise<ToolOutputs[N]>, manifest: Manifest, byId: Map<string, ManifestEntry>, planPath: string, rel: (p: string) => string, needHuman: (what: string) => void }} ApproveContext
 */

/**
 * `pxsig approve <sub>`: plan, apply, list, undo, verify. The CLI passes its context.
 * `fail` prints the message and exits: it never returns.
 * @param {{ sub: string | undefined, args: string[], flags: Flags, format: string, tools: typeof import('./mcp.mjs').tools, project: Project, serverUrl: string, CMD: string, fail: (message: string, code?: number) => never }} opts
 */
export async function approveCommand({
  sub,
  args,
  flags,
  format,
  tools,
  project: P,
  serverUrl,
  CMD,
  fail,
}) {
  /**
   * @template {keyof ToolOutputs} N
   * @param {N} name
   * @param {Record<string, unknown>} [a]
   */
  const run = (name, a = {}) =>
    // `pxsig_${name}` is one of the tools; ToolOutputs says what is read of its result.
    /** @type {{ run: (args: object) => Promise<ToolOutputs[N]> }} */ (
      /** @type {unknown} */ (tools.find((t) => t.name === `pxsig_${name}`))
    ).run({ project: P.name, ...a });
  // The manifest is pxsig's own (`pxsig index` writes it).
  const manifest = /** @type {Manifest} */ (JSON.parse(readFileSync(P.manifestPath(), 'utf8')));
  const byId = new Map(manifest.stories.map((e) => [e.id, e]));
  const planPath = join(P.store.reports, 'approval-plan.json');
  /** @param {string} p */
  const rel = (p) => relPath(P.workspaceRoot, p);
  /** @param {string} what */
  const needHuman = (what) => {
    if (humanAtTerminal()) return;
    fail(
      `${what} needs a person at a terminal: ${whyNotPerson()}. Run it yourself in a terminal.`,
      3
    );
  };
  /** @type {ApproveContext} */
  const cx = {
    args,
    flags,
    format,
    P,
    serverUrl,
    CMD,
    fail,
    run,
    manifest,
    byId,
    planPath,
    rel,
    needHuman,
  };
  if (sub === 'plan') return planCommand(cx);
  if (sub === 'apply') return applyCommand(cx);
  if (sub === 'log') return logCommand(cx);
  if (sub === 'undo') return undoCommand(cx);
  if (sub === 'verify') return verifyCommand(cx);

  fail(
    `usage: approve plan | apply | log [--trace] | undo <batch> | verify [--no-strict] [--since <ref>] [--suite <name> | --all-suites] [--adopt]`
  );
}
