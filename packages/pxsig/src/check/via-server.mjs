/**
 * check/via-server.mjs — when the pxsig server holds the store, the check runs in its queue: post
 * the selection, wait for the queue to drain, report the rows the server wrote and exit with the
 * check's code. `--since` / `--changed` go with it, so the server compares the React Compiler's
 * view of those files with the merge base, as the check here would (check.json's `react`). Also
 * `gitHead`, the commit a run checked.
 */
import { spawnSync } from '../lib/spawn.mjs';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { relPath } from '../lib/paths.mjs';
import { reactConfig } from '../lib/react/config.mjs';
import { reactLines, reactSarif } from './react.mjs';
import {
  appendReadiness,
  checkCounts,
  checkFindings,
  lastLine,
  outcome,
  readinessTally,
} from '../lib/enforcement.mjs';
/** @import { CheckSetup, Die } from './setup.mjs' */
/** @import { Project } from '../types.js' */
/** @import { CheckReport, QueuedCheck, ServerStatus } from '../types/t4.js' */
/** @import { CheckReact, ReactRun } from '../types/react.js' */

/**
 * What the check compares with, for the server: `{ since }` or `{ changed }` (workspace-relative),
 * and `react: false` when React is off here (`--no-react`, PXSIG_REACT=off); empty without either flag.
 * @param {CheckSetup} S
 * @returns {{ since?: string, changed?: string[], react?: false }}
 */
export function comparedWith(S) {
  const { P, flags, str } = S;
  const since = str('since');
  const changed = str('changed');
  if (!since && !changed) return {};
  const off = reactConfig(P, { flags }).off ? { react: /** @type {const} */ (false) } : {};
  if (!changed) return { since: /** @type {string} */ (since), ...off };
  const files = changed
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => (isAbsolute(f) ? relPath(P.workspaceRoot, f) : f));
  return { changed: files, ...off };
}

/**
 * check.json's `react` as the run that wrote it: what reactLines and reactSarif read.
 * @param {CheckReact | undefined} block
 * @returns {ReactRun | null}
 */
const runOf = (block) =>
  !block
    ? null
    : 'skipped' in block
      ? {
          ran: false,
          why: block.skipped,
          text: 'react: analysis failed (in the server): nothing compared',
        }
      : /** @type {ReactRun} */ (/** @type {unknown} */ ({ ran: true, report: block }));

/**
 * The commit this run checked (for `ci status --from-report`), or null outside git.
 * @param {Project} P
 */
export function gitHead(P) {
  const r = spawnSync('git', ['-C', P.workspaceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * The server holds this store: queue the selection there, wait for its queue to drain, and report
 * the rows it wrote. Exits with the check's code.
 * @param {CheckSetup} S
 * @param {string} url
 * @param {string[]} ids
 * @param {string[]} [stories]
 */
export async function viaServer(S, url, ids, stories = []) {
  const { P, flags, reports, enf } = S;
  /** @type {Die} */
  const die = S.die;
  console.log(
    `[check] the pxsig server at ${url} holds this store: queueing ${ids.length} entries there${stories.length ? ` (and registering ${stories.length} new)` : ''}`
  );
  // A Response, or (the server did not answer) this stand-in without a status.
  const post = /** @type {Response | { ok: false, status?: undefined, statusText: string }} */ (
    await fetch(`${url}/__pxsig/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: P.name, ids, stories, via: 'check', ...comparedWith(S) }),
    }).catch(
      // fetch rejects with an Error (a TypeError) when the server does not answer.
      (/** @type {Error} */ e) => ({ ok: false, statusText: e.message })
    )
  );
  if (!post.ok)
    die(
      `the server holding the store did not take the check (${post.status ?? ''} ${post.statusText ?? ''}); stop it or try again`
    );
  // The server's answer to POST /__pxsig/check (docs/server.md).
  const answer = /** @type {QueuedCheck} */ (await post.json().catch(() => ({})));
  for (const x of answer.skipped ?? []) console.log(`[check] not checked: ${x.name}: ${x.why}`);
  if (answer.registered?.length)
    console.log(
      `[check] the server registered ${answer.registered.length} NEW entries (no signature: a person approves their first render)`
    );
  if (Array.isArray(answer.queued)) ids = answer.queued;
  if (!ids.length) die('no entries selected');
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    // GET /__pxsig/status (docs/server.md), or null when the server does not answer.
    const s = /** @type {ServerStatus | null} */ (
      await fetch(`${url}/__pxsig/status`, { signal: AbortSignal.timeout(5000) })
        .then((r) => r.json())
        .catch(() => null)
    );
    if (!s) die('the server went away during the check');
    if (!s.running && !s.queued) break;
    if (Date.now() - t0 > (Number(flags['timeout-s']) || 1800) * 1000)
      die('timed out waiting for the server queue');
  }
  // check.json, as the server wrote it.
  const report = /** @type {CheckReport} */ (
    JSON.parse(readFileSync(join(reports, 'check.json'), 'utf8'))
  );
  const want = new Set(ids);
  const rows = report.rows.filter((r) => want.has(r.id));
  const failed = rows.filter((r) => !r.pass);
  console.log(
    `[check] ${rows.length} checked via the server · ${rows.length - failed.length} pass · ${failed.length} changed · ${((Date.now() - t0) / 1000).toFixed(1)} s`
  );
  for (const r of failed.slice(0, 20))
    console.log(`  CHANGED ${r.id.padEnd(60)} ${r.error ?? (r.reasons ?? []).join('; ')}`);
  // The React lines and `--react-sarif`, as the check here prints and writes them.
  // Only when this run compared: an earlier run's block stays in check.json until the next one.
  const react =
    S.str('since') || S.str('changed')
      ? runOf(/** @type {CheckReact | undefined} */ (report.react))
      : null;
  for (const l of reactLines(react, rows, P)) console.log(l);
  const sarif = S.str('react-sarif');
  if (sarif) console.log(reactSarif(sarif, react, rows, S.manifest.stories));
  // `enf` is null only under --update, which never hands the run to a server.
  const gated = outcome(/** @type {NonNullable<typeof enf>} */ (enf), checkFindings(rows));
  appendReadiness(P, /** @type {NonNullable<typeof enf>} */ (enf), gated, {
    source: 'check',
    counts: checkCounts(rows),
  });
  const last = lastLine(
    /** @type {NonNullable<typeof enf>} */ (enf),
    gated,
    /** @type {NonNullable<typeof enf>} */ (enf).configured.length ? readinessTally(P) : null
  );
  if (last) console.log(`[pxsig] ${last}`);
  process.exit(gated.exit);
}
