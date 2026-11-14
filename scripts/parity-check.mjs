#!/usr/bin/env node
/**
 * parity-check.mjs — source parity for an adapter (packages/pxsig/src/dashboard-check/parity.mjs):
 * each contract component its conformance.json pairs with a design-system story, rendered beside
 * that story in one browser and compared (box model, font, rendered alignment; not colour).
 *
 *   node scripts/parity-check.mjs --storybook <dir> [--ui <adapter>] [--build <dir>] [--out <dir>]
 *                                 [--themes dark,light] [--container]
 *
 * --storybook   the design system's built Storybook (`storybook build`), inside this checkout
 * --ui          the adapter (as the dashboard build takes it); default: the one the build would use
 * --build       the parity page already built with that adapter; default: built now, into
 *               <out>/adapter (packages/dashboard/test/harness/parity, the dashboard's Vite config)
 * --out         default target/parity: report.json, summary.md, shots/
 * --container   render in pxsig's image (docker/screens-image.json), as pxsig's own screens are:
 *               the page is built here first, then this script runs there on it
 *
 * Exit: 0 every pair rendered and matches, or differs only as its `expect` says · 1 a difference,
 * a pair that did not render, or a malformed `parity` entry · 2 setup (no Storybook, no Chromium,
 * no Docker).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');

/** @param {string[]} args @param {string} name */
const flag = (args, name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const args = process.argv.slice(2);
  const storybook = flag(args, 'storybook');
  const out = resolve(flag(args, 'out') ?? join(repo, 'target', 'parity'));
  /** @type {('dark' | 'light')[]} */
  const themes = [];
  for (const t of (flag(args, 'themes') ?? 'dark,light').split(','))
    if (t === 'dark' || t === 'light') themes.push(t);
  if (!storybook || !existsSync(join(storybook, 'iframe.html'))) {
    console.error('[parity] --storybook must name a built Storybook (a folder with iframe.html)');
    process.exit(2);
  }
  const { resolveAdapter } = await import('../packages/dashboard/build-config.mjs');
  const ui = resolveAdapter({ adapter: flag(args, 'ui'), cwd: repo });
  let built = flag(args, 'build');
  if (!built) {
    built = join(out, 'adapter');
    rmSync(built, { recursive: true, force: true });
    const { buildParityPage } = await import('../packages/dashboard/parity-page.mjs');
    await buildParityPage({ adapter: flag(args, 'ui'), cwd: repo, outDir: built });
    console.log(`[parity] built the parity page with the ${ui.name} adapter`);
  }
  if (args.includes('--container')) {
    const { dockerArgs, pinnedImage } = await import('./screens-container.mjs');
    const rest = ['--storybook', resolve(storybook), '--build', resolve(built), '--out', out];
    const ui2 = flag(args, 'ui');
    if (ui2) rest.push('--ui', ui2);
    rest.push('--themes', themes.join(','));
    const user =
      process.getuid && process.getgid ? `${process.getuid()}:${process.getgid()}` : null;
    const r = spawnSync(
      'docker',
      dockerArgs({
        image: pinnedImage(repo),
        repo,
        user,
        args: rest,
        script: 'scripts/parity-check.mjs',
      }),
      { stdio: 'inherit' }
    );
    if (r.error) {
      console.error(`[parity] docker: ${r.error.message}`);
      process.exit(2);
    }
    process.exit(r.status === null || r.status >= 125 ? 2 : r.status);
  }

  const { launchBrowser } = await import('../packages/pxsig/src/lib/capture.mjs');
  const { paritySummary, runParity } =
    await import('../packages/pxsig/src/dashboard-check/parity.mjs');
  // The adapter's conformance.json, as `pxsig dashboard gaps` reads it; runParity checks its pairs.
  const conformance =
    /** @type {import('../packages/pxsig/src/types/parity.js').ParityConformance} */ (
      /** @type {unknown} */ (JSON.parse(readFileSync(join(ui.dir, 'conformance.json'), 'utf8')))
    );
  let browser;
  try {
    browser = await launchBrowser({ root: repo, workspaceRoot: repo });
  } catch (e) {
    console.error(`[parity] no Chromium: ${/** @type {Error} */ (e).message.split('\n')[0]}`);
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  const started = Date.now();
  const { results, problems } = await runParity(browser, {
    conformance,
    storybook: resolve(storybook),
    adapter: resolve(built),
    outDir: out,
    themes,
    log: (s) => console.log(s),
  }).finally(() => browser.close());
  const failing = results.filter((r) => !r.rendered || r.differences.some((d) => !d.expected));
  const report = {
    adapter: ui.name,
    // Where it rendered: pxsig's image (PXSIG_PLAYWRIGHT is its Playwright) or this machine.
    env: process.env.PXSIG_PLAYWRIGHT ? 'container' : 'local',
    themes,
    ms: Date.now() - started,
    summary: {
      pairs: results.length,
      rendered: results.filter((r) => r.rendered).length,
      differing: failing.length,
      expected: results.reduce((n, r) => n + r.differences.filter((d) => d.expected).length, 0),
    },
    problems,
    results,
  };
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, 'summary.md'), paritySummary(results, problems));
  const shown = relative(repo, out) || '.';
  console.log(
    `[parity] ${results.length} pairs · ${failing.length} differ or did not render · ${report.summary.expected} expected · ${shown}/summary.md`
  );
  for (const p of problems) console.log(`  conformance ${p}`);
  process.exit(failing.length || problems.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
