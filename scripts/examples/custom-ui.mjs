/**
 * custom-ui.mjs — the custom-ui example of examples-test.mjs: the dashboard rebuilt on a plain UI adapter.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @import { BuildStamp, DashboardCheckAnswer, GapsAnswer } from '../types-release.js' */
import { log, expect, pxsig, pnpm, stage } from './shared.mjs';

/** The dashboard rebuilt on a plain UI adapter, from the installed pxsig. */
export function runCustomUi() {
  const name = 'custom-ui';
  log(`${name}: staging`);
  const dir = stage(name);
  pnpm(
    ['install', '--ignore-workspace', '--no-frozen-lockfile', '--config.confirmModulesPurge=false'],
    dir,
    { stdio: 'inherit' }
  );
  let r = pxsig(['dashboard', 'gaps', '--json'], dir);
  // `dashboard gaps --json`'s answer.
  const g = /** @type {GapsAnswer} */ (JSON.parse(r.stdout || '{}'));
  const missing = (g.rows ?? []).filter((x) => x.status === 'missing');
  expect(
    r.status === 0 && !g.problems?.length,
    `gaps: no problems (exit ${r.status}${r.stderr ? `, ${r.stderr.trim()}` : ''})`
  );
  expect(
    missing.length > 0 && missing.every((x) => !x.required),
    `gaps: ${missing.length} optional components left to fallbacks, every required one present`
  );
  r = pxsig(['dashboard', 'build', '--out', 'dashboard-build'], dir);
  expect(
    r.status === 0 &&
      existsSync(join(dir, 'dashboard-build', 'index.html')) &&
      existsSync(join(dir, 'dashboard-build', 'assets', 'app.js')),
    `build: index.html and assets/app.js${r.status ? `\n${r.stdout}${r.stderr}` : ''}`
  );
  expect(
    !/type="module"/.test(readFileSync(join(dir, 'dashboard-build', 'index.html'), 'utf8')),
    'build: a classic script, so a static report opens from disk'
  );
  // The stamp `dashboard build` wrote.
  const stamp = /** @type {BuildStamp} */ (
    JSON.parse(readFileSync(join(dir, 'dashboard-build', 'pxsig-build.json'), 'utf8'))
  );
  expect(stamp.pxsig, 'build: stamped with the pxsig version, for serve');
  expect(
    stamp.contract && stamp.adapterContract === stamp.contract,
    `build: stamped with the UI contract (${stamp.contract}) and the adapter's (${stamp.adapterContract})`
  );
  r = pxsig(['dashboard', 'gaps', '--json'], dir);
  expect(
    // `dashboard gaps --json`'s answer.
    /** @type {GapsAnswer} */ (JSON.parse(r.stdout)).contract?.status === 'same',
    'gaps: the adapter is written for this contract'
  );
  // Every feature on a design system other than the reference, from the shipped sample data.
  // --strict: an axe violation or a layout finding fails it too.
  r = pxsig(['dashboard', 'check', '--build', 'dashboard-build', '--strict', '--json'], dir);
  /** @type {DashboardCheckAnswer} */
  let c = {};
  try {
    // `dashboard check --json`'s answer.
    c = /** @type {DashboardCheckAnswer} */ (JSON.parse(r.stdout || '{}'));
  } catch {
    c = {};
  }
  const s = c.summary ?? {};
  const failed = (c.screens ?? [])
    .filter((x) => !x.rendered)
    // How long it waited and any page error: a landmark missing after a hang reads differently from
    // one missing after a slow render (shell.top-bar #1 failed once on windows-latest, cause unknown).
    .map(
      (x) =>
        `${x.feature} #${x.index + 1} ${x.theme}: ${x.reason} (${x.ms ?? '?'} ms${x.errors?.length ? `, page errors: ${x.errors.join(' | ')}` : ''})`
    );
  const found = (c.screens ?? []).flatMap((x) =>
    [
      ...(x.axe ?? []).map((a) => `axe ${a.id} (${a.count})`),
      ...(x.layout ?? []).map((l) => `${l.rule}: ${l.text}`),
    ].map((f) => `${x.feature} #${x.index + 1} ${x.theme}: ${f}`)
  );
  expect(
    !found.length,
    `check --strict: ${s.withAxe ?? 0} screens with axe violations, ${s.withLayout ?? 0} with layout findings${found.length ? `: ${found.slice(0, 8).join('; ')}${found.length > 8 ? ` and ${found.length - 8} more` : ''}` : ''}`
  );
  expect(
    // With no summary, `undefined > 0` is false: the check fails, as it should. --strict exits 1
    // on findings, which the expectation above names.
    (r.status === 0 || (r.status === 1 && found.length > 0)) &&
      /** @type {number} */ (s.screens) > 0 &&
      s.failed === 0,
    `check: ${s.rendered ?? 0} of ${s.screens ?? 0} screens rendered, both themes${r.status ? ` (exit ${r.status}${failed.length ? `: ${failed.join('; ')}` : ''}${r.stderr ? `, ${r.stderr.trim()}` : ''})` : ''}`
  );
  const out = join(dir, 'node_modules', '.cache', 'pxsig', 'dashboard-check');
  expect(
    existsSync(join(out, 'index.html')) && existsSync(join(out, 'summary.md')),
    'check: the gallery and summary.md'
  );
  if (process.env.GITHUB_STEP_SUMMARY && existsSync(join(out, 'summary.md')))
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${readFileSync(join(out, 'summary.md'), 'utf8')}\n`
    );
  log(`${name}: done (${dir})`);
}
