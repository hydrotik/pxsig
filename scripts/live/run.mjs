/**
 * live/run.mjs — the live screens: the real `pxsig serve` (the CLI) on the staged example
 * (scripts/live/stage.mjs), driven through the reviewer's flows (scripts/live/flows.mjs) on one page,
 * one screenshot, accessibility snapshot, axe and layout pass per step, in each theme. Called by
 * scripts/screens-check.mjs, in pxsig's container; the results have the shape of `dashboardCheck`'s
 * screens, so the entries, locks, findings and the engine's check are the fixture screens' code.
 *
 * Each run of the flows starts from a clean scratch store: the staged store removed, Badge.jsx and
 * storybook-static restored from the pristine copies, `pxsig manifest`, `pxsig check --full`
 * (12 new), the engine's baseline for the 9 entries that are not `components-badge--*@dark` (what
 * approving them does, in this scratch store only), `pxsig check --full` again (9 pass, 3 new).
 *
 * Approvals here are clicks on the page of a server this run started, in that scratch store, with a
 * link minted from that server's own CLI token (as `pxsig serve --link` does). Nothing in
 * packages/dashboard/.pxsig is approved or written by a flow. Ports 6006 and 6070 are refused.
 *
 * The engine: the checkout's when PXSIG_LIVE_BIN names a build of it (the screens workflow builds
 * one on the runner, docs/releasing.md), so the live screens run the server, CLI and engine of this
 * commit; else the image's (PXSIG_BIN). The browser and fonts are the image's either way.
 *
 * `repeat`: the flows run that many times per theme. A step's accessibility snapshot must be the
 * same text on every run, and its screenshot the same pixels or, failing that, within the gate as
 * the check judges a render against its baseline (the example's own story renders, shown in the
 * inspector, can differ by a pixel between runs); else the step fails as "not deterministic". Any
 * difference keeps both renders under `keep` and is logged.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  describe,
  FIXED_TIME,
  LANDMARK_MS,
  load,
  locate,
  screenContext,
  snap,
} from '../../packages/pxsig/src/dashboard-check/capture.mjs';
import { waitMarkupStable } from '../../packages/pxsig/src/lib/capture.mjs';
import { readToken } from '../../packages/pxsig/src/lib/guard.mjs';
import { rustBinary } from '../../packages/pxsig/src/lib/workspace/peers.mjs';
import { copyTree } from '../lib/copy-tree.mjs';
import { FEATURES, STEPS } from './flows.mjs';
import { assertSafeUrl, DEAD_URL, idle, startLiveServer } from './server.mjs';
import { CHANGE, LIVE_BASE, liveDir, pristineDir, repo } from './stage.mjs';
import { routeOf, scrubber } from './volatile.mjs';

// Playwright's types, through capture.mjs (playwright resolves from packages/pxsig, not scripts/).
/** @typedef {Parameters<typeof screenContext>[0]} Browser */
/** @typedef {Awaited<ReturnType<typeof screenContext>>} BrowserContext */
/** @typedef {Parameters<typeof snap>[0]} Page */
/** @import { ScreenCapture, ScreenResult } from '../../packages/pxsig/src/types/t4.js' */
/** @import { LiveAction, LiveStep } from './types.js' */

export const PROJECT = 'example-single';
/**
 * The staged workspace runs this checkout's pxsig inside an image built for a released one: without
 * this, every Overview would show that mismatch (a setup finding naming both versions), a property
 * of the harness that would also change the screens at every version bump.
 */
const NO_IMAGE = { PXSIG_IMAGE: '', PXSIG_IMAGE_REVISION: '', PXSIG_IMAGE_DIGEST: '' };
/** The example's new entries at the start of a run; every other entry has a baseline. */
const NEW_AT_START = /^components-badge--[a-z]+@dark$/;
/** pngjs's reader, as far as samePixels uses it (pngjs resolves from packages/pxsig). */
const { PNG } =
  /** @type {{ PNG: { sync: { read: (b: Buffer) => { width: number, height: number, data: Buffer } } } }} */ (
    createRequire(join(repo, 'packages', 'pxsig', 'package.json'))('pngjs')
  );

/** The ids a feature's steps make, for messages: `live--approve-2`. */
export const stepName = (/** @type {LiveStep} */ s) => `${s.feature.replace('.', '--')}-${s.n}`;

/** The live catalogue in screens.json's shape: one screen per step (scripts/screens-check.mjs). */
export function liveCatalogue() {
  return {
    features: FEATURES.map((f) => ({
      ...f,
      section: 'live',
      components: [],
      screens: STEPS.filter((s) => s.feature === f.id)
        .sort((a, b) => a.n - b.n)
        .map((s) => ({ scenario: 'live', wait: s.wait })),
    })),
  };
}

/**
 * A fresh scratch store: 9 entries pass, 3 are new.
 * @param {string} dir the staged example
 * @param {(m: string) => void} log
 */
async function prepare(dir, log) {
  const { pxsigIn } = await import('../examples/shared.mjs');
  const { baselineAll, checkJson } = await import('../examples/steps.mjs');
  rmSync(join(dir, '.pxsig'), { recursive: true, force: true });
  copyFileSync(join(pristineDir(), 'Badge.jsx'), join(dir, CHANGE.file));
  swapStorybook(dir, 'storybook-static');
  const env = { ...NO_IMAGE, PXSIG_STORYBOOK_URL: DEAD_URL, PXSIG_URL: DEAD_URL };
  const run = (/** @type {string[]} */ args, /** @type {number} */ want) => {
    const r = pxsigIn(args, dir, env);
    if (r.status !== want)
      throw new Error(`pxsig ${args.join(' ')}: exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  };
  run(['manifest'], 0);
  run(['check', '--full', '--retries', '0'], 1);
  const ids = checkJson(dir, PROJECT)
    .rows.map((r) => r.id)
    .filter((id) => !NEW_AT_START.test(id));
  const b = baselineAll(dir, PROJECT, { withEnv: true, only: ids });
  if (b.summary.failed || b.summary.stories !== 9)
    throw new Error(`baselines: ${b.summary.stories} written, ${b.summary.failed} failed`);
  run(['check', '--full', '--retries', '0'], 1);
  const rows = checkJson(dir, PROJECT).rows;
  if (rows.filter((r) => r.pass).length !== 9 || rows.filter((r) => r.new).length !== 3)
    throw new Error('the scratch store does not start with 9 passing and 3 new entries');
  log('[live] scratch store: 9 pass, 3 new');
}

/** Replace the staged storybook-static with a pristine build (the server reads it per request). */
function swapStorybook(/** @type {string} */ dir, /** @type {string} */ build) {
  rmSync(join(dir, 'storybook-static'), { recursive: true, force: true });
  copyTree(join(pristineDir(), build), join(dir, 'storybook-static'));
}

/**
 * Route the scrubbed answers of `context` through `scrub`, collecting its problems.
 * @param {BrowserContext} context
 * @param {ReturnType<typeof scrubber>} sc
 * @param {string[]} problems
 */
async function scrubRoutes(context, sc, problems) {
  await context.route(
    (u) => routeOf(u.href) != null,
    async (route) => {
      const res = await route.fetch();
      /** @type {unknown} */
      let body;
      try {
        body = await res.json();
      } catch {
        return route.fulfill({ response: res });
      }
      problems.push(...sc.scrub(/** @type {string} */ (routeOf(route.request().url())), body));
      return route.fulfill({ response: res, json: body });
    }
  );
}

/**
 * Run the flows once in one theme. Returns one result per step, in STEPS order.
 * @param {{ browser: Browser, theme: 'dark' | 'light', dashboard: string, axe: string, out: string, log: (m: string) => void, want: (s: LiveStep) => boolean }} o
 */
async function runOnce({ browser, theme, dashboard, axe, out, log, want }) {
  const dir = liveDir();
  await prepare(dir, log);
  const { env: shEnv, stateHome, browsers, pxsigIn } = await import('../examples/shared.mjs');
  const S = await startLiveServer({
    dir,
    base: LIVE_BASE,
    dashboard,
    env: {
      ...shEnv,
      HOME: stateHome,
      XDG_STATE_HOME: stateHome,
      PLAYWRIGHT_BROWSERS_PATH: browsers,
      ...NO_IMAGE,
    },
  });
  const url = assertSafeUrl(S.url);
  const sc = scrubber();
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {BrowserContext[]} */
  const contexts = [];
  const open = async () => {
    const c = await screenContext(browser, theme, { bypassCSP: true });
    contexts.push(c);
    await scrubRoutes(c, sc, problems);
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(String(e.message ?? e).split('\n')[0]));
    await p.clock.setFixedTime(new Date(FIXED_TIME));
    return p;
  };
  // Idle, then the data as it now stands, through the scrub: a displayed time's rank counts every
  // value the server reached, whether or not the page happened to fetch it.
  const observe = async () => {
    await idle(url);
    const r = await fetch(`${url}/__pxsig/data`, { signal: AbortSignal.timeout(10_000) });
    problems.push(...sc.scrub('data', await r.json()));
  };
  await observe();
  const main = await open();
  /** @type {Page} */
  let page = main;
  const address = (/** @type {string} */ hash, /** @type {string | null} */ ticket) => {
    const tab = hash.replace(/^#/, '');
    const frag = [tab ? `tab=${tab}` : '', ticket ? `ticket=${ticket}` : ''].filter(Boolean);
    return `${url}/report/?theme=${theme}${frag.length ? `#${frag.join('&')}` : ''}`;
  };
  /** @param {LiveAction} a */
  const act = async (a) => {
    if (a.link) {
      // A link minted by this server from its own CLI token, as `pxsig serve --link` does.
      const token = readToken(dir, url);
      if (!token) throw new Error('no CLI token for the live server');
      const r = await fetch(`${url}/__pxsig/ticket`, {
        method: 'POST',
        headers: { 'x-pxsig-token': token },
      });
      const link = /** @type {{ link?: string }} */ (await r.json()).link ?? '';
      if (!link.startsWith(`${url}/report/#`)) throw new Error('the live server minted no link');
      page = main;
      await page.goto('about:blank');
      await load(page, address(a.link, link.split('#ticket=')[1]));
    } else if (a.readOnly) {
      page = await open();
      await load(page, address(a.readOnly, null));
    } else if (a.click) await locate(page, a.click).click({ timeout: LANDMARK_MS });
    else if (a.press) await page.keyboard.press(a.press);
    else if (a.cli) {
      const r = pxsigIn(a.cli, dir, { ...NO_IMAGE, PXSIG_URL: url, PXSIG_STORYBOOK_URL: DEAD_URL });
      if (r.status !== 0 && r.status !== 1)
        throw new Error(`pxsig ${a.cli.join(' ')}: exit ${r.status}\n${r.stderr}`);
    } else if (a.change) {
      const f = join(dir, CHANGE.file);
      writeFileSync(f, readFileSync(f, 'utf8').replace(CHANGE.from, CHANGE.to));
      swapStorybook(dir, 'storybook-static-after');
    } else if (a.stop) await S.stop();
    if (S.proc.exitCode === null && S.proc.signalCode === null) await observe();
  };
  /** @type {ScreenResult[]} */
  const results = [];
  /** @type {string | null} */
  let failed = null;
  try {
    for (const step of STEPS) {
      const started = Date.now();
      const name = stepName(step);
      const feature = /** @type {import('./types.js').LiveFeature} */ (
        FEATURES.find((f) => f.id === step.feature)
      );
      const shot = join(out, `${step.feature}__${step.n}__${theme}.png`);
      /** @type {Omit<ScreenCapture, 'ms' | 'retried'>} */
      let r;
      if (failed) r = notRendered(`an earlier step failed (${failed})`);
      else
        try {
          // Every step starts on the first page; a read-only page is its own step's only.
          page = main;
          errors.length = 0;
          problems.length = 0;
          for (const a of step.actions) await act(a);
          await locate(page, step.wait)
            .waitFor({ state: 'visible', timeout: LANDMARK_MS })
            .catch(() => {
              throw new Error(`landmark missing: ${describe(step.wait)}`);
            });
          await still(page);
          const c = await snap(page, {
            shot,
            axe: want(step) ? axe : '',
            layout: want(step),
            aria: true,
            anchors: feature.anchors ?? [],
            errors,
            restore: true,
          });
          if (problems.length) throw new Error(`scrub: ${problems[0]}`);
          if (c.aria && /\b(?:127\.0\.0\.1|localhost):(?!1\b)\d+/.test(c.aria))
            throw new Error('a server address with its port is on the page');
          r = c;
          if (!c.rendered) failed = name;
        } catch (e) {
          failed = name;
          r = notRendered(String(/** @type {Error} */ (e).message ?? e).split('\n')[0]);
        }
      if (want(step))
        results.push({
          feature: step.feature,
          title: feature.title,
          purpose: feature.purpose,
          components: [],
          index: step.n - 1,
          scenario: 'live',
          theme,
          fallbacks: null,
          referenceShot: null,
          ...r,
          ms: Date.now() - started,
          shot: r.rendered ? shot : null,
        });
      if (failed === name) log(`[live] ${name}@${theme}: ${r.reason}`);
    }
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    await S.stop();
  }
  return results;
}

/**
 * Bring the page to rest beyond what snap's settle sees: Web Animations (a component's JS-driven
 * fade, which the freeze stylesheet cannot stop) finished, and the markup (a chart drawn on its own
 * clock) unchanged across polls.
 * @param {Page} page
 */
async function still(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations())
      try {
        a.finish();
      } catch {
        // an endless animation cannot finish: it is left as it is
      }
  });
  await waitMarkupStable(page, 'body');
}

/**
 * @param {string} reason
 * @returns {Omit<ScreenCapture, 'ms' | 'retried'>}
 */
const notRendered = (reason) => ({ rendered: false, reason, errors: [], axe: [], layout: [] });

/**
 * Run 2's render against run 1's, as the check judges a render against its baseline: the engine's
 * signature of `a`, then `b` compared with the default gate.
 * @param {string} a
 * @param {string} b
 * @param {string} sig where the signature goes
 * @returns {{ pass: boolean, ssim: number | null }}
 */
function withinGate(a, b, sig) {
  const bin = rustBinary();
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

/**
 * Same pixels? (Byte-identical files are; otherwise decoded and compared.)
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function samePixels(a, b) {
  const x = readFileSync(a);
  const y = readFileSync(b);
  if (x.equals(y)) return true;
  const p = PNG.sync.read(x);
  const q = PNG.sync.read(y);
  return p.width === q.width && p.height === q.height && p.data.equals(q.data);
}

/**
 * The live screens, in each theme. `only`: the live features to keep (all when null); the flows
 * always run in full, since each step starts where the one before ended.
 * @param {{ browser: Browser, dashboard: string, axe: string, out: string, keep: string, themes: ('dark' | 'light')[], repeat?: number, only?: string[] | null, log?: (m: string) => void }} o
 * @returns {Promise<ScreenResult[]>}
 */
export async function runLive({
  browser,
  dashboard,
  axe,
  out,
  keep,
  themes,
  repeat = 1,
  only = null,
  log = (m) => console.log(m),
}) {
  if (!existsSync(join(pristineDir(), 'storybook-static-after', 'index.json')))
    throw new Error(
      'the live workspace is not staged: run scripts/screens-container.mjs (it stages it)'
    );
  const want = (/** @type {LiveStep} */ s) => !only || only.includes(s.feature);
  // The checkout's engine for everything the live run starts (server, CLI, the gate between runs),
  // until it returns; a run that throws ends the check.
  const image = process.env.PXSIG_BIN;
  const live = process.env.PXSIG_LIVE_BIN;
  if (live) {
    const v = spawnSync(live, ['--version'], { encoding: 'utf8' });
    if (v.status !== 0) throw new Error(`PXSIG_LIVE_BIN does not run here: ${v.stderr || v.error}`);
    log(`[live] engine: this checkout's (${v.stdout.trim()})`);
    process.env.PXSIG_BIN = live;
  }
  /** @type {ScreenResult[]} */
  const all = [];
  for (const theme of themes) {
    /** @type {ScreenResult[][]} */
    const runs = [];
    for (let k = 1; k <= repeat; k++) {
      log(`[live] ${theme}: run ${k} of ${repeat}`);
      const dirK = join(out, `run${k}`);
      mkdirSync(dirK, { recursive: true });
      runs.push(await runOnce({ browser, theme, dashboard, axe, out: dirK, log, want }));
    }
    const [first, ...rest] = runs;
    let identical = 0;
    first.forEach((r, i) => {
      for (const [j, other] of rest.entries()) {
        const o = other[i];
        if (!r.rendered || !o.rendered || !r.shot || !o.shot) continue;
        const pixels = samePixels(r.shot, o.shot);
        if (pixels && r.aria === o.aria) {
          identical++;
          continue;
        }
        const id = `live--${r.feature.split('.')[1]}-${r.index + 1}@${theme}`;
        mkdirSync(keep, { recursive: true });
        copyFileSync(r.shot, join(keep, `${id}.run1.png`));
        copyFileSync(o.shot, join(keep, `${id}.run${j + 2}.png`));
        if (r.aria !== o.aria) {
          writeFileSync(join(keep, `${id}.run1.aria.yml`), r.aria ?? '');
          writeFileSync(join(keep, `${id}.run${j + 2}.aria.yml`), o.aria ?? '');
        }
        // Pixels that differ within the gate never show as a change against a baseline: kept,
        // logged, and not a failure. Outside it, or a different structure, the step fails.
        const gate = pixels ? null : withinGate(r.shot, o.shot, join(keep, `${id}.pxsig.json`));
        if (r.aria === o.aria && gate?.pass) {
          log(`[live] ${id}: run ${j + 2} differs in pixels within the gate (ssim ${gate.ssim})`);
          continue;
        }
        Object.assign(r, {
          rendered: false,
          shot: null,
          reason: `not deterministic: run ${j + 2} differs in ${r.aria !== o.aria ? 'its accessibility snapshot' : `pixels beyond the gate (ssim ${gate?.ssim})`} (both kept in reports/live-repeat)`,
        });
        break;
      }
    });
    if (rest.length)
      log(
        `[live] ${theme}: ${repeat} runs, ${identical} of ${first.length} steps the same pixels and structure`
      );
    all.push(...first);
  }
  if (image === undefined) delete process.env.PXSIG_BIN;
  else process.env.PXSIG_BIN = image;
  return all;
}
