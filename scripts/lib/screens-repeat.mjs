/**
 * screens-repeat.mjs — the fixture screens rendered twice in one screens run (screens-check.mjs),
 * so a screen that changes between two renders of the same build is caught by name in the run that
 * renders it, not later as a spurious change against its baseline.
 *
 * Pass 2 renders every fixture screen of pass 1 again: the same build, the same container, the same
 * browser binary and launch arguments, but a browser of its own (a second launch, not pass 1's
 * process, so no shared memory cache, GPU process or font state can make two renders agree that
 * would not agree in a fresh run), its own scenario servers, and the features in reverse order (each
 * screen has other neighbours in the four-way pool, so it renders under a different load). The cost
 * is one browser launch, about a second.
 *
 * Two renders of one screen must agree on whether they rendered, their pixels (exact: decoded RGBA,
 * not the file bytes), their accessibility snapshot and their anchors' boxes. A pixel difference is
 * also put to the gate (the engine's `capture` of render 1, `compare` of render 2, as the check
 * judges a render against its baseline), which the report states; within the gate or not, it is a
 * difference and the screen is unstable. An unstable screen fails the check, with what differed
 * (pixel count, region box, gate, the first structure line that differs) and both renders kept under
 * the store's reports/fixture-repeat/, unless packages/dashboard/fixtures/unstable.json lists it with
 * its reason. That list is committed and reviewed like a baseline; an entry that names no screen
 * fails, and one whose screen rendered the same twice is noted, to be removed.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardCheck } from '../../packages/pxsig/src/dashboard-check.mjs';
import { launchBrowser } from '../../packages/pxsig/src/lib/capture.mjs';
import { verdictEngine } from './screens-verdict.mjs';

/** @import { Project } from '../../packages/pxsig/src/types.js' */
/** @import { ScreenCatalogue, ScreenResult } from '../../packages/pxsig/src/types/t4.js' */
/** @typedef {NonNullable<Parameters<typeof dashboardCheck>[0]>} CheckFlags */
/** @typedef {NonNullable<Parameters<typeof dashboardCheck>[2]>} CheckOpts */
/** @typedef {{ report: { screens: ScreenResult[] }, outDir: string }} Checked */
/** @typedef {{ width: number, height: number, data: Buffer }} Image */
/** @typedef {{ x: number, y: number, w: number, h: number }} Box */
/**
 * One screen whose two renders differ.
 * @typedef {{ id: string, what: string[], pixels: number | null, box: Box | null, gate: { pass: boolean, ssim: number | null } | null, aria: string | null }} Unstable
 */

const THEMES = ['dark', 'light'];
const repo = fileURLToPath(new URL('../..', import.meta.url));
const { PNG } = /** @type {{ PNG: { sync: { read: (b: Buffer) => Image } } }} */ (
  createRequire(join(repo, 'packages', 'pxsig', 'package.json'))('pngjs')
);

/**
 * The pixels two images differ in, and the box around them. Different sizes: every pixel.
 * @param {Image} a
 * @param {Image} b
 * @returns {{ pixels: number, box: Box | null, size: string | null }}
 */
export function pixelDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height)
    return {
      pixels: Math.max(a.width * a.height, b.width * b.height),
      box: null,
      size: `${a.width}×${a.height} then ${b.width}×${b.height}`,
    };
  let pixels = 0;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data.readUInt32BE(i) === b.data.readUInt32BE(i)) continue;
    pixels++;
    const p = i / 4;
    const x = p % a.width;
    const y = (p - x) / a.width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return {
    pixels,
    box: pixels ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
    size: null,
  };
}

/**
 * The first line two texts differ on, as `line n: <render 1> | <render 2>`, or null when equal.
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
export function firstLineDiff(a, b) {
  if ((a ?? '') === (b ?? '')) return null;
  const x = (a ?? '').split('\n');
  const y = (b ?? '').split('\n');
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  const cut = (/** @type {string | undefined} */ s) =>
    s === undefined ? '(none)' : s.trim().slice(0, 120);
  return `line ${i + 1}: ${cut(x[i])} | ${cut(y[i])}`;
}

/** @param {Box | null} b */
const boxText = (b) => (b ? `${b.w}×${b.h} at ${b.x},${b.y}` : 'the whole screen');

/**
 * The screens of `second` whose render differs from the same screen in `first`.
 * @param {ScreenResult[]} first
 * @param {ScreenResult[]} second
 * @param {{ idOf: (x: ScreenResult) => string, read: (x: ScreenResult) => Image, gate: (a: ScreenResult, b: ScreenResult) => { pass: boolean, ssim: number | null } }} io
 * @returns {Unstable[]}
 */
export function compareRepeat(first, second, { idOf, read, gate }) {
  const again = new Map(second.map((x) => [idOf(x), x]));
  /** @type {Unstable[]} */
  const out = [];
  for (const a of first) {
    const id = idOf(a);
    const b = again.get(id);
    /** @type {Unstable} */
    const u = { id, what: [], pixels: null, box: null, gate: null, aria: null };
    if (!b) u.what.push('not rendered by pass 2');
    else if (a.rendered !== b.rendered)
      u.what.push(
        a.rendered
          ? `pass 2 did not render it: ${b.reason}`
          : `only pass 2 rendered it (${a.reason})`
      );
    else if (a.rendered && b.rendered) {
      const d = pixelDiff(read(a), read(b));
      if (d.pixels) {
        Object.assign(u, { pixels: d.pixels, box: d.box, gate: gate(a, b) });
        const g = u.gate?.pass ? 'within the gate' : 'beyond the gate';
        u.what.push(
          `${d.pixels} px differ, ${d.size ?? boxText(d.box)} (${g}, ssim ${u.gate?.ssim ?? '?'})`
        );
      }
      u.aria = firstLineDiff(a.aria, b.aria);
      if (u.aria) u.what.push(`structure differs, ${u.aria}`);
      const ka = JSON.stringify(a.anchors ?? {});
      const kb = JSON.stringify(b.anchors ?? {});
      if (ka !== kb) u.what.push(`anchors differ: ${ka} | ${kb}`.slice(0, 300));
    }
    if (u.what.length) out.push(u);
  }
  return out;
}

/**
 * Which unstable screens fail: those the allow-list does not name. Entries that name no screen of
 * the catalogue fail too; listed screens that were stable are noted.
 * @param {Unstable[]} unstable
 * @param {Record<string, string>} allow entry id → why it may differ between renders
 * @param {{ ids: Set<string>, checked: Set<string> }} screens every fixture entry id, and those this run rendered twice
 */
export function repeatVerdict(unstable, allow, { ids, checked }) {
  const listed = (/** @type {Unstable} */ u) => Object.hasOwn(allow, u.id);
  const failed = unstable.filter((u) => !listed(u));
  const allowed = unstable.filter(listed);
  const unknown = Object.keys(allow).filter((id) => !ids.has(id));
  const steady = Object.keys(allow).filter(
    (id) => checked.has(id) && !unstable.some((u) => u.id === id)
  );
  const problems = [
    ...failed.map((u) => `unstable ${u.id}: ${u.what.join('; ')}`),
    ...unknown.map((id) => `unstable.json names no screen: ${id}`),
  ];
  const notes = [
    ...allowed.map((u) => `unstable ${u.id} (allowed: ${allow[u.id]}): ${u.what.join('; ')}`),
    ...steady.map((id) => `unstable.json lists ${id}, which rendered the same twice`),
  ];
  return { failed, allowed, unknown, steady, problems, notes };
}

/**
 * The report a run writes beside the kept renders, Markdown for the job summary.
 * @param {ReturnType<typeof repeatVerdict>} v
 * @param {number} screens how many screens were rendered twice
 */
export function repeatMarkdown(v, screens) {
  const lines = [
    '### Fixture screens rendered twice',
    '',
    `${screens - v.failed.length - v.allowed.length} of ${screens} screens rendered the same pixels and structure twice.`,
  ];
  if (v.problems.length || v.notes.length)
    lines.push('', ...[...v.problems, ...v.notes].map((p) => `- ${p}`));
  return `${lines.join('\n')}\n`;
}

/**
 * Run pass 2 and judge it: keeps both renders of each unstable screen in the store's
 * reports/fixture-repeat/, writes unstable.json and summary.md there, and returns the verdict.
 * `flags` and `opts` are pass 1's `dashboardCheck` arguments; pass 2 runs it with its own browser,
 * output folder and the catalogue reversed.
 * @param {{ P: Project, first: Checked, flags: CheckFlags, opts: CheckOpts & { browser: NonNullable<CheckOpts['browser']> }, idOf: (x: ScreenResult) => string, log: (m: string) => void }} o
 */
export async function fixtureRepeat({ P, first, flags, opts, idOf, log }) {
  const keep = join(P.store.reports, 'fixture-repeat');
  const allowFile = join(P.root, 'fixtures', 'unstable.json');
  const catalogue = /** @type {ScreenCatalogue} */ (
    JSON.parse(readFileSync(join(P.root, 'fixtures', 'screens.json'), 'utf8'))
  );
  const ids = new Set(
    catalogue.features.flatMap((f) =>
      f.screens.flatMap((_, index) =>
        THEMES.map((theme) => idOf(/** @type {ScreenResult} */ ({ feature: f.id, index, theme })))
      )
    )
  );
  const browser = await launchBrowser(P);
  /** @type {Checked} */
  let second;
  try {
    if (browser.version() !== opts.browser.version())
      throw new Error(
        `pass 2's browser is ${browser.version()}, pass 1's ${opts.browser.version()}`
      );
    log('[screens] pass 2 of 2: the fixture screens again, in a browser of their own');
    second = await dashboardCheck({ ...flags, out: join(first.outDir, 'pass2') }, repo, {
      ...opts,
      browser,
      catalogue: { features: [...catalogue.features].reverse() },
    });
  } finally {
    await browser.close().catch(() => {});
  }
  const file = (/** @type {Checked} */ c, /** @type {ScreenResult} */ x) =>
    isAbsolute(x.shot ?? '') ? /** @type {string} */ (x.shot) : join(c.outDir, x.shot ?? '');
  const bin = verdictEngine(process.env, P.rustBin);
  rmSync(keep, { recursive: true, force: true });
  mkdirSync(keep, { recursive: true });
  const unstable = compareRepeat(first.report.screens, second.report.screens, {
    idOf,
    read: (x) =>
      PNG.sync.read(readFileSync(file(first.report.screens.includes(x) ? first : second, x))),
    gate: (a, b) =>
      withinGate(file(first, a), file(second, b), join(keep, `${idOf(a)}.pxsig.json`), bin),
  });
  for (const u of unstable)
    for (const [k, c] of /** @type {const} */ ([
      [1, first],
      [2, second],
    ])) {
      const x = c.report.screens.find((s) => idOf(s) === u.id);
      if (x?.rendered && x.shot) copyFileSync(file(c, x), join(keep, `${u.id}.pass${k}.png`));
    }
  const allow = existsSync(allowFile)
    ? (/** @type {{ screens?: Record<string, string> }} */ (
        JSON.parse(readFileSync(allowFile, 'utf8'))
      ).screens ?? {})
    : {};
  const v = repeatVerdict(unstable, allow, {
    ids,
    checked: new Set(first.report.screens.map(idOf)),
  });
  const n = first.report.screens.length;
  writeFileSync(
    join(keep, 'unstable.json'),
    `${JSON.stringify({ screens: n, unstable }, null, 2)}\n`
  );
  writeFileSync(join(keep, 'summary.md'), repeatMarkdown(v, n));
  log(
    `[screens] 2 passes: ${n - unstable.length} of ${n} fixture screens the same pixels and structure`
  );
  return v;
}

/**
 * Render 2 against render 1 with the engine's default gate, as live/run.mjs judges two runs.
 * @param {string} a
 * @param {string} b
 * @param {string} sig where render 1's signature goes
 * @param {string} bin the engine
 * @returns {{ pass: boolean, ssim: number | null }}
 */
function withinGate(a, b, sig, bin) {
  spawnSync(bin, ['capture', a, '--out', sig], { encoding: 'utf8' });
  const r = spawnSync(bin, ['compare', b, sig, '--json'], { encoding: 'utf8' });
  try {
    // `pxsig compare --json` (docs/cli.md), as far as this reads it.
    const j = /** @type {{ pass?: boolean, metrics?: { ssim?: number } }} */ (JSON.parse(r.stdout));
    return { pass: j.pass === true, ssim: j.metrics?.ssim ?? null };
  } catch {
    return { pass: false, ssim: null };
  }
}
