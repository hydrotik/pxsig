/**
 * check/render.mjs — stage 2, render (the page pool, the Storybook-error sentinel, `.selected.json`,
 * trimming to content), and stage 4, retry: a failure that passes on a fresh render is flaky.
 */
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { renderStories, STORYBOOK_ERROR } from '../lib/capture.mjs';
import { noBaseline, storybookBroken } from '../lib/rows.mjs';
/** @import { CheckSetup, Die } from './setup.mjs' */
/** @import { Selection } from './select.mjs' */
/** @import { Prepared } from './prepare.mjs' */
/** @import { Compared } from './compare.mjs' */
/** @import { EngineCheckOutput, EngineCheckRow, TrimResult } from '../types/t4.js' */

/** @typedef {Awaited<ReturnType<typeof renderSelection>>} Rendered */

/**
 * @param {CheckSetup} S
 * @param {Selection} sel
 * @param {Prepared} prep
 */
export async function renderSelection(S, sel, prep) {
  const { manifest, concurrency, P, flags, pngDir, reports, rust } = S;
  const { entries, selected } = sel;
  const { pool } = prep;
  /** @type {Die} */
  const die = S.die;
  // --- 2. render ---------------------------------------------------------------------------
  const renderOpts = { ...manifest, concurrency, project: P, a11y: !flags['no-a11y'] };
  const {
    results,
    wallMs,
    reloads = 0,
  } = entries.length
    ? await renderStories(pool, entries, pngDir, renderOpts)
    : { results: [], wallMs: 0 };
  const renderErrors = results.filter((r) => r.error).length;
  console.log(
    `[check] rendered ${results.length} entries in ${(wallMs / 1000).toFixed(1)} s on ${concurrency} pages · ${reloads} page loads${renderErrors ? ` · ${renderErrors} errors` : ''}`
  );
  // Sentinel: renders that hit Storybook's error page. Most of the run → a setup problem, not results.
  const sbErrors = results.filter((r) => r.error?.startsWith(STORYBOOK_ERROR));
  if (storybookBroken(sbErrors.length, results.length)) {
    await pool.close();
    die(
      `setup error: ${sbErrors.length} of ${results.length} renders hit Storybook's error page (${/** @type {string} */ (sbErrors[0].error).slice(STORYBOOK_ERROR.length).trim()}). Nothing was recorded.`
    );
  }
  const render = new Map(results.map((r) => [r.id, r]));
  const onlyFile = join(reports, '.selected.json');
  writeFileSync(onlyFile, JSON.stringify([...selected]));
  // Crop renders to their content (Rust, in place, parallel): the grid lands on the component.
  const trimArgs = manifest.trim
    ? [
        '--pad',
        String(manifest.trim.pad ?? 16),
        '--tolerance',
        String(manifest.trim.tolerance ?? 8),
      ]
    : null;
  const trimDir = (/** @type {string} */ dir, /** @type {(string | undefined)[]} */ ids) => {
    if (!trimArgs || !ids.length) return null;
    writeFileSync(onlyFile, JSON.stringify(ids));
    // `pxsig trim --json`.
    const r = /** @type {TrimResult} */ (
      JSON.parse(rust(['trim', dir, '--only', `@${onlyFile}`, '--json', ...trimArgs]).out)
    );
    writeFileSync(onlyFile, JSON.stringify([...selected]));
    return r;
  };
  const trimmed = trimDir(
    pngDir,
    results.filter((r) => r.png).map((r) => r.id)
  );
  if (trimmed)
    console.log(
      `[check] trimmed ${trimmed.trimmed}/${trimmed.files} renders to content · ${Math.round((trimmed.pixelsAfter / trimmed.pixelsBefore) * 100)}% of pixels kept · ${trimmed.elapsedMs.toFixed(0)} ms (Rust)`
    );
  return { renderOpts, results, wallMs, reloads, renderErrors, render, onlyFile, trimDir };
}

/**
 * Re-render what failed, up to `--retries` times; closes the page pool. Returns the time it took.
 * @param {CheckSetup} S
 * @param {Selection} sel
 * @param {Prepared} prep
 * @param {Rendered} run
 * @param {Compared} cmp
 */
export async function retry(S, sel, prep, run, cmp) {
  const { retries, P, rust } = S;
  const { entries, selected } = sel;
  const { pool } = prep;
  const { render, renderOpts, trimDir, onlyFile } = run;
  const { rows, checkArgs } = cmp;
  // --- 4. retry failures: a pass on a fresh render is flaky, not a regression -------------------
  let retryMs = 0;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const failing = [...rows.values()]
      .filter((r) => r.pass !== true && !r.flaky && !noBaseline(r) && render.get(r.id)?.png)
      .map((r) => r.id);
    if (!failing.length) break;
    const t = performance.now();
    const dir = join(P.store.retry, String(attempt));
    rmSync(dir, { recursive: true, force: true });
    const again = await renderStories(
      pool,
      entries.filter((e) => failing.includes(e.id)),
      dir,
      { ...renderOpts, a11y: false }
    );
    trimDir(
      dir,
      again.results.filter((r) => r.png).map((r) => r.id)
    );
    writeFileSync(onlyFile, JSON.stringify(failing));
    // `pxsig check --json`, for the failing ids only.
    const res = /** @type {EngineCheckOutput} */ (
      JSON.parse(rust(checkArgs(dir, join(P.store.diffs, 'retry')), {}).out)
    );
    for (const r of res.results)
      if (r.pass === true) {
        // The retry checked only ids taken from `rows`.
        const row = /** @type {EngineCheckRow} */ (rows.get(r.id));
        row.flaky = true;
        row.retry = { attempt, metrics: r.metrics };
      }
    retryMs += performance.now() - t;
    console.log(
      `[check] retry ${attempt}: ${failing.length} re-rendered · ${res.results.filter((r) => r.pass).length} passed (flaky)`
    );
  }
  await pool.close();
  writeFileSync(onlyFile, JSON.stringify([...selected]));
  return retryMs;
}
