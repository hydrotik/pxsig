#!/usr/bin/env node
/**
 * check.mjs — the full check, Rust-first (`pxsig check`).
 *
 *   pxsig check [--project name] [--suite matrix] [--since main | --changed a.tsx,b.css.ts]
 *               [--modes dark,light] [--only id,id] [--concurrency 8] [--retries 2] [--no-a11y]
 *               [--update] [--link-base http://127.0.0.1:6070/report/] [--sarif a11y.sarif]
 *               [--warn[=gate,…]] [--enforce[=gate,…]]
 *
 * 1. select   manifest v2 entries; `--since <ref>` asks `pxsig affected` (Rust: import
 *             graph from git) and skips the rest, carrying their last result forward;
 * 2. render   the page pool (lib/capture.mjs) across browsers / viewports / themes,
 *             with masks, interaction states and an axe pass per render;
 * 3. check    `pxsig check` (Rust): per-entry gates + grids, the detail channel,
 *             a content cache, run history, and pixel-diff regions for failures;
 * 4. retry    failures re-render up to `--retries` times; a pass on retry is
 *             `flaky` (reported, not failing);
 * 5. a11y     violations compared with the a11y baseline → `new` per entry;
 * 6. report   <store>/reports/check.json, plus `pxsig report` → summary.md (PR comment)
 *             and junit.xml.
 *
 * `--update` renders the selection and writes baselines instead (`pxsig baseline`: each `.psig`
 * carries the render as its image and the environment it was rendered in) and the a11y baseline
 * (not with `--kind environment`). Exit: 0 pass · 1 change found, or a wrong --update phrase
 * · 2 setup error (with `--strict-env`, baselines from a different environment) · 3 --update
 * without a person.
 *
 * Warn mode (lib/enforcement.mjs): a gate set to `warn` in the committed config (or by `--warn`, a
 * person at a terminal) runs the same check and exits `advisoryExit` (0) where it alone would have
 * failed, with ADVISORY lead and last lines, `enforcement` in check.json and a lead in summary.md.
 * The a11y gate (new axe violations) is `warn` by default and says nothing unless one appears.
 *
 * Environment (lib/env.mjs): every row records the environment of its render and compares it with
 * its baseline's; a `mismatch` is a warning (`[check] env:`, `summary.md`, `pxsig doctor`), and
 * with `--strict-env` (config `env.strict`, `PXSIG_STRICT_ENV=1`) a refusal before rendering.
 *
 * One writer per store (lib/lock.mjs): the check takes `<store>/reports/.lock`. When the pxsig server
 * holds it (it serves this project), the selection goes through the server's queue instead
 * (POST /__pxsig/check, then wait) and the result is read back from its report; `--update`,
 * `--suite` and `--no-server` refuse instead. Another running check makes this one refuse.
 *
 * Storybook: when `storybook.url` does not answer and `storybook.staticDir` holds a build, the
 * check serves that build itself on a free port (lib/static.mjs).
 */
import { openCheck } from './check/setup.mjs';
import { select } from './check/select.mjs';
import { prepare } from './check/prepare.mjs';
import { renderSelection, retry } from './check/render.mjs';
import { update } from './check/update.mjs';
import { compare } from './check/compare.mjs';
import { report } from './check/report.mjs';

/**
 * The stages, in order (src/check/). Each one that ends the run exits the process.
 * @param {string[]} argv the arguments after `check`
 */
async function main(argv) {
  const S = openCheck(argv);
  const t0 = performance.now();
  const sel = select(S);
  const prep = await prepare(S, sel);
  const run = await renderSelection(S, sel, prep);
  if (S.flags.update) await update(S, sel, prep, run);
  const cmp = compare(S, sel, run);
  const retryMs = await retry(S, sel, prep, run, cmp);
  await report(S, sel, prep, run, cmp, { t0, retryMs });
}

await main(process.argv.slice(2));
