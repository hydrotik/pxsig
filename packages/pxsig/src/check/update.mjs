/**
 * check/update.mjs — `--update`: writes baselines from this run's renders instead of checking (a
 * person at a terminal, a typed phrase, every old baseline snapshotted and logged), and the a11y
 * baseline unless `--kind environment`. Always exits.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newBatch, record, snapshot } from '../lib/approvals.mjs';
import { ask } from '../lib/term.mjs';
import { writeJson } from '../lib/files.mjs';
import { byId } from '../lib/env.mjs';
/** @import { CheckSetup, Die } from './setup.mjs' */
/** @import { Selection } from './select.mjs' */
/** @import { Prepared } from './prepare.mjs' */
/** @import { Rendered } from './render.mjs' */
/** @import { ManifestEntry } from '../types.js' */
/** @import { A11yBaseline, BaselineResult } from '../types/t4.js' */

/**
 * @param {CheckSetup} S
 * @param {Selection} sel
 * @param {Prepared} prep
 * @param {Rendered} run
 * @returns {Promise<never>}
 */
export async function update(S, sel, prep, run) {
  const { P, reports, rust, runPath, pngDir, str, kind, a11yBaselinePath } = S;
  const { entries } = sel;
  const { pool, fence, current } = prep;
  const { results, renderErrors, onlyFile } = run;
  /** @type {Die} */
  const die = S.die;
  const ok = results.filter((r) => r.png).map((r) => r.id);
  // Writing baselines unseen is the riskiest thing pxsig does: a person at a terminal only, a typed
  // phrase, and every old baseline snapshotted + logged (lib/approvals.mjs) so `approve undo` works.
  // For reviewed changes prefer `cli.mjs approve plan` / `apply`, which also checks colour vs shape.
  const phrase = `UPDATE ${ok.length} BASELINES`;
  if (
    (await ask(
      `--update replaces ${ok.length} baselines with renders nobody reviewed. Type "${phrase}" to continue: `
    )) !== phrase
  ) {
    await pool.close();
    die('not confirmed: nothing was written', 1);
  }
  fence();
  const batch = newBatch('check-update');
  const before = new Map(
    ok.map((id) => [
      id,
      snapshot(
        P,
        // `ok` holds ids of entries this run rendered.
        /** @type {ManifestEntry} */ (entries.find((e) => e.id === id)),
        batch
      ).before,
    ])
  );
  writeFileSync(onlyFile, JSON.stringify(ok));
  // Each baseline keeps the environment of its own render (its browser's), never of anything else.
  const envFile = join(reports, '.env-plan.json');
  writeFileSync(
    envFile,
    JSON.stringify({
      envs: byId(current),
      byId: Object.fromEntries(
        entries
          .filter((e) => ok.includes(e.id))
          .map(
            (e) =>
              /** @type {[string, string | undefined]} */ ([
                e.id,
                current[e.browser ?? 'chromium']?.id,
              ])
          )
          .filter(([, v]) => v)
      ),
    })
  );
  const b = rust([
    'baseline',
    '--manifest',
    runPath,
    '--png-dir',
    pngDir,
    '--root',
    P.workspaceRoot,
    '--only',
    `@${onlyFile}`,
    '--env',
    `@${envFile}`,
    '--json',
  ]);
  rmSync(envFile, { force: true });
  // `pxsig baseline --json`.
  const res = /** @type {BaselineResult} */ (JSON.parse(b.out));
  for (const id of ok)
    record(
      P,
      // `ok` holds ids of `entries`.
      /** @type {{ id: string, sig: string }} */ (entries.find((e) => e.id === id)),
      {
        batch,
        via: 'check-update',
        reason: str('reason') ?? 'pxsig check --update',
        kind,
        before: before.get(id),
      }
    );
  if (kind !== 'environment') {
    // a11y.json, as pxsig writes it.
    const a11yBase = existsSync(a11yBaselinePath)
      ? /** @type {A11yBaseline} */ (JSON.parse(readFileSync(a11yBaselinePath, 'utf8')))
      : {};
    for (const r of results)
      if (r.a11y?.violations)
        // renderStories gives every result its entry's id.
        a11yBase[/** @type {string} */ (r.id)] = r.a11y.violations.map((v) => v.id).sort();
    writeJson(a11yBaselinePath, a11yBase, { pretty: true });
  }
  await pool.close();
  console.log(
    `[check] baselines: ${res.summary.stories - res.summary.failed} written in ${res.summary.elapsedMs.toFixed(0)} ms (Rust) · ${res.summary.failed} failed · render errors ${renderErrors}`
  );
  for (const e of res.errors) console.error(`  ${e}`);
  process.exit(res.summary.failed || renderErrors ? 2 : 0);
}
