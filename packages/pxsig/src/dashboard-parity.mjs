/**
 * dashboard-parity.mjs — `pxsig dashboard parity`: each contract component an adapter pairs with its
 * design system's story, rendered beside that story and compared (dashboard-check/parity.mjs;
 * docs/ui/build-adapter.md, "Source parity").
 *
 *   pxsig dashboard parity --storybook <dir> [--ui path] [--build dir] [--out dir] [--themes dark,light] [--json]
 *
 * What the author supplies:
 *   - their design system's built Storybook (`storybook build`; the folder holding iframe.html),
 *     with the stories the pairs name;
 *   - in the adapter's conformance.json, a `parity` list on each component to compare (the story id,
 *     URL args, the component's props and children, expected differences with reasons), and at its
 *     top `parity.storyRoot` / `parity.globals` when their Storybook needs them;
 *   - the project's Vite (as `pxsig dashboard build`): the parity page is built with the adapter,
 *     unless `--build` names one built before.
 * It reads no project data and writes only --out (default node_modules/.cache/pxsig/dashboard-parity):
 * report.json, summary.md, shots/ and the built page.
 *
 * Exit: 0 every pair rendered and matches (or differs only as its `expect` says) · 1 a difference,
 * a pair that did not render, or a malformed `parity` entry · 2 setup: no Storybook, no pairs, no
 * Chromium, no Vite.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { adapterOf, dashboardSource, projectVite } from './dashboard.mjs';
import { launchBrowser } from './lib/capture.mjs';
import { PXSIG_VERSION } from './lib/workspace.mjs';
import { parityPairs, paritySummary, runParity } from './dashboard-check/parity.mjs';
/** @import { Flags } from './types.js' */
/** @import { DashboardBuildConfig, DashboardUiTools } from './types/t4.js' */
/** @import { ParityConformance, ParityResult } from './types/parity.js' */

/** A setup problem: exit 2. */
export class ParitySetupError extends Error {}

/** How many differences a pair prints; summary.md and report.json have them all. */
const SHOWN = 6;
const DOC = 'docs/ui/build-adapter.md, "Source parity"';

/** @type {(dir: string, file: string) => Promise<unknown>} */
const load = (dir, file) => import(pathToFileURL(join(dir, file)).href);

/**
 * @param {Flags} flags
 * @param {string} [cwd]
 * @param {(m: string) => void} [log]
 * @returns {Promise<{ code: number, report: { adapter: string, pxsig: string, themes: string[], summary: { pairs: number, rendered: number, differing: number, expected: number }, problems: string[], results: ParityResult[] }, outDir: string }>}
 */
export async function dashboardParity(flags, cwd = process.cwd(), log = () => {}) {
  if (typeof flags.storybook !== 'string')
    throw new ParitySetupError(
      "pass --storybook <folder>: your design system's built Storybook (the output of `storybook build`, the folder that holds iframe.html), with the stories conformance.json pairs"
    );
  const storybook = resolve(cwd, flags.storybook);
  if (!existsSync(join(storybook, 'iframe.html')))
    throw new ParitySetupError(
      `${relative(cwd, storybook) || storybook} holds no iframe.html: it is not a built Storybook. Run \`storybook build\` in your design system and pass its output folder`
    );
  const ui = await adapterOf(flags, cwd);
  const src = dashboardSource();
  const { readConformance } = /** @type {DashboardUiTools} */ (await load(src, 'ui-tools.mjs'));
  // conformance.json as the adapter wrote it; parityPairs checks every pair it declares.
  const conformance = /** @type {ParityConformance} */ (readConformance(ui.dir) ?? {});
  const { pairs } = parityPairs(conformance);
  if (!pairs.length)
    throw new ParitySetupError(
      `the "${ui.name}" adapter's conformance.json pairs no component with a story: add a \`parity\` list to each component to compare, naming its story id and the props that draw it (${DOC})`
    );
  const outDir = resolve(
    cwd,
    typeof flags.out === 'string' ? flags.out : 'node_modules/.cache/pxsig/dashboard-parity'
  );
  /** @type {('dark' | 'light')[]} */
  const themes = [];
  for (const t of String(typeof flags.themes === 'string' ? flags.themes : 'dark,light').split(','))
    if (t === 'dark' || t === 'light') themes.push(t);
  let page = typeof flags.build === 'string' ? resolve(cwd, flags.build) : null;
  if (page && !existsSync(join(page, 'index.html')))
    throw new ParitySetupError(
      `--build ${flags.build} holds no index.html: build the parity page first, or leave --build out`
    );
  if (!page) {
    page = join(outDir, 'page');
    rmSync(page, { recursive: true, force: true });
    // The dashboard source's own modules (packages/dashboard).
    const { packageDir } = /** @type {DashboardBuildConfig} */ (
      await load(src, 'build-config.mjs')
    );
    const { vite, react, vanillaExtractPlugin } = await projectVite(cwd, packageDir, 'parity');
    const { buildParityPage } =
      /** @type {{ buildParityPage: (o: Record<string, unknown>) => Promise<void> }} */ (
        await load(src, 'parity-page.mjs')
      );
    log(`[parity] building the parity page with the "${ui.name}" adapter`);
    await buildParityPage({
      adapter: ui.file,
      cwd,
      outDir: page,
      resolveFrom: [cwd],
      vite,
      react,
      vanillaExtractPlugin,
    });
  }
  let browser;
  try {
    browser = await launchBrowser({ root: cwd, workspaceRoot: cwd });
  } catch (e) {
    throw new ParitySetupError(
      `no Chromium (${/** @type {Error} */ (e).message.split('\n')[0]}): npx playwright install chromium`
    );
  }
  mkdirSync(outDir, { recursive: true });
  const { results, problems } = await runParity(browser, {
    conformance,
    storybook,
    adapter: page,
    outDir,
    themes,
    log,
  }).finally(() => browser.close().catch(() => {}));
  const failing = results.filter((r) => !r.rendered || r.differences.some((d) => !d.expected));
  const report = {
    adapter: ui.name,
    pxsig: PXSIG_VERSION,
    themes,
    summary: {
      pairs: results.length,
      rendered: results.filter((r) => r.rendered).length,
      differing: failing.length,
      expected: results.reduce((n, r) => n + r.differences.filter((d) => d.expected).length, 0),
    },
    problems,
    results,
  };
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, 'summary.md'), paritySummary(results, problems));
  return { code: failing.length || problems.length ? 1 : 0, report, outDir };
}

/**
 * The command's text: the counts, each pair that did not render with why, each pair that differs
 * with its first differences, and where the rest are.
 * @param {Awaited<ReturnType<typeof dashboardParity>>} r
 * @param {string} cwd
 */
export function parityText({ report, outDir }, cwd) {
  const s = report.summary;
  const where = relative(cwd, outDir) || outDir;
  return [
    `${s.pairs} ${s.pairs === 1 ? 'pair' : 'pairs'} (story × theme) on the "${report.adapter}" adapter · ${s.differing} differ or did not render${s.expected ? ` · ${s.expected} expected differences` : ''}`,
    ...report.problems.map((p) => `  conformance.json: ${p}`),
    ...report.results.flatMap((r) => {
      const head = `  ${r.component} · ${r.story} (${r.theme})`;
      if (!r.rendered) return [`${head}: did not render: ${r.reason}`];
      const open = r.differences.filter((d) => !d.expected);
      if (!open.length) return [];
      return [
        `${head}: ${open.length} difference${open.length === 1 ? '' : 's'}`,
        ...open
          .slice(0, SHOWN)
          .map((d) => `    ${d.element} ${d.property}: story ${d.story}, adapter ${d.adapter}`),
        ...(open.length > SHOWN ? [`    and ${open.length - SHOWN} more`] : []),
      ];
    }),
    `summary: ${join(where, 'summary.md')} · shots: ${join(where, 'shots')}`,
    ...(s.differing
      ? [
          `fix each difference in the adapter, or list one made on purpose in the pair's \`expect\` with its reason (${DOC})`,
        ]
      : []),
  ].join('\n');
}
