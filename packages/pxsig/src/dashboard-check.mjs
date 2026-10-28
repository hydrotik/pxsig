/**
 * dashboard-check.mjs — `pxsig dashboard check`: every dashboard feature's screens, rendered on the
 * project's adapter build from shipped sample data, in each theme, beside the prebuilt reference
 * dashboard (docs/ui/build-adapter.md, "Verify").
 *
 *   pxsig dashboard check [--ui path] [--build dir] [--out dir] [--reference dir] [--themes dark,light] [--only feature,…]
 *                         [--strict] [--json]
 *
 * What it does, and what it does not:
 *   - Sample data only: the scenarios in the dashboard's fixtures/scenarios.mjs, never the project's
 *     report or store. The screens are fixtures/screens.json, generated from src/ui/features.ts.
 *   - Both builds are served on 127.0.0.1, on ephemeral ports, by a small server in this process
 *     that answers /__pxsig/ from the scenario. A POST is answered and recorded; nothing is written.
 *   - Playwright's Chromium (decision 91's list), 1280×900, reduced motion, the clock fixed and the
 *     caret hidden. For each screen and theme: load, run its actions, wait for its landmark, take a
 *     screenshot, run axe-core, and record page errors.
 *   - Writes only under --out (default node_modules/.cache/pxsig/dashboard-check): index.html (the
 *     gallery), report.json, summary.md and the screenshots.
 *
 * Exit: 0 every screen rendered with no page error · 1 a screen failed, or (with --strict) axe
 * violations · 2 setup: no build, no Chromium, or an adapter for an older major UI contract.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { dashboardSource } from './dashboard.mjs';
import { axeScript, injectAxe, launchBrowser } from './lib/capture.mjs';
import { buildDirFor, STAMP } from './lib/dashboard-dir.mjs';
import { PXSIG_VERSION } from './lib/workspace.mjs';
import { prebuiltDashboardDir } from './report.mjs';

/** A setup problem: exit 2. */
export class CheckSetupError extends Error {}

export const VIEWPORT = { width: 1280, height: 900 };
/** The clock every screen sees, so relative times ("2 days ago") are the same on every run. */
export const FIXED_TIME = '2026-10-25T12:00:00.000Z';
const THEMES = ['dark', 'light'];
const LANDMARK_MS = 10_000;
const FREEZE =
  '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';

const load = (dir, file) => import(pathToFileURL(join(dir, file)).href);
/** A path for messages: relative to `cwd` when it is inside it, else absolute. */
const shown = (cwd, p) => {
  const r = relative(cwd, p);
  return r && !r.startsWith('..') ? r : p;
};
const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

/** A built dashboard folder: index.html with the data placeholder, and its assets. */
export function isDashboardBuild(dir) {
  if (!dir || !existsSync(join(dir, 'index.html')) || !existsSync(join(dir, 'assets')))
    return false;
  return /<!--pxsig:data-->|<script id="pxsig-data">/.test(
    readFileSync(join(dir, 'index.html'), 'utf8')
  );
}

/**
 * The sample images: a card with a button, and the same card with the button moved, so the
 * inspector shows a baseline, a render and a diff with a real change in it.
 */
function sampleImages(width = 320, height = 200) {
  const draw = (dx, paint) => {
    const p = new PNG({ width, height });
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const [r, g, b] = paint(x, y, dx);
        p.data[i] = r;
        p.data[i + 1] = g;
        p.data[i + 2] = b;
        p.data[i + 3] = 255;
      }
    return p;
  };
  const scene = (x, y, dx) => {
    const card = x >= 20 && x < width - 20 && y >= 20 && y < height - 20;
    const button = x >= 60 + dx && x < 180 + dx && y >= 120 && y < 152;
    return button ? [56, 112, 224] : card ? [236, 238, 242] : [200, 204, 212];
  };
  const baseline = draw(0, scene);
  const render = draw(16, scene);
  const diff = draw(0, (x, y) => {
    const i = (y * width + x) * 4;
    const same =
      baseline.data[i] === render.data[i] &&
      baseline.data[i + 1] === render.data[i + 1] &&
      baseline.data[i + 2] === render.data[i + 2];
    return same ? [236, 238, 242] : [214, 48, 48];
  });
  return {
    baseline: PNG.sync.write(baseline),
    render: PNG.sync.write(render),
    diff: PNG.sync.write(diff),
  };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

/**
 * A server for one build and one scenario: the build under /report/, /__pxsig/ from the scenario,
 * images under /p/demo/. `posts` records every POST; none reaches anything that writes.
 */
export function scenarioServer({ dir, scenario, fixtures, images, posts }) {
  const open = new Set();
  const server = createServer((req, res) => {
    open.add(res);
    res.on('close', () => open.delete(res));
    const u = new URL(req.url, 'http://x');
    const send = (status, type, body) =>
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
    if (u.pathname.startsWith('/__pxsig/')) {
      const name = u.pathname.slice('/__pxsig/'.length);
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(body || 'null');
          } catch {
            parsed = body;
          }
          posts.push({ scenario, name, body: parsed });
          send(200, 'application/json', JSON.stringify({ ok: true }));
        });
        return;
      }
      if (name === 'events') {
        if (scenario === 'offline') return send(503, 'text/plain', 'offline');
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        return res.write('retry: 600000\nevent: hello\ndata: {}\n\n');
      }
      if (name === 'data') {
        if (scenario === 'loading') return; // the data never arrives: the loading line stays
        if (scenario === 'load-error')
          return send(500, 'application/json', JSON.stringify({ error: fixtures.LOAD_ERROR }));
        try {
          return send(200, 'application/json', JSON.stringify(fixtures.scenarioData(scenario)));
        } catch (e) {
          return send(500, 'application/json', JSON.stringify({ error: e.message }));
        }
      }
      if (name === 'projects')
        return send(
          200,
          'application/json',
          JSON.stringify({
            projects:
              fixtures.SERVER_STATES.includes(scenario) || fixtures.SCENARIOS[scenario]
                ? fixtures.projectsOf(scenario)
                : [],
          })
        );
      return send(404, 'application/json', '{"error":"not found"}');
    }
    if (u.pathname.startsWith('/p/demo/')) {
      if (u.pathname.startsWith('/p/demo/sig/'))
        return send(
          200,
          'application/json',
          JSON.stringify({
            format: 'psig',
            entry: { id: decodeURIComponent(u.pathname.slice('/p/demo/sig/'.length)) },
          })
        );
      if (u.pathname.endsWith('.png'))
        return send(
          200,
          'image/png',
          u.pathname.includes('/diffs/')
            ? images.diff
            : u.pathname.includes('/base')
              ? images.baseline
              : images.render
        );
      return send(404, 'text/plain', '');
    }
    if (!u.pathname.startsWith('/report')) return send(404, 'text/plain', '');
    const rel = decodeURIComponent(u.pathname.replace(/^\/report\/?/, '')) || 'index.html';
    const file = resolve(dir, rel);
    if (relative(dir, file).startsWith('..') || !existsSync(file))
      return send(404, 'text/plain', '');
    if (rel === 'index.html' && scenario === 'static') {
      // As `pxsig report` writes it: the data inlined, marked static.
      const json = JSON.stringify({ ...fixtures.scenarioData('clean'), static: true }).replace(
        /</g,
        '\\u003c'
      );
      return send(
        200,
        TYPES['.html'],
        readFileSync(file, 'utf8').replace(
          /<script id="pxsig-data">[\s\S]*?<\/script>|<!--pxsig:data-->/,
          `<script id="pxsig-data">window.PXSIG=${json}</script>`
        )
      );
    }
    send(200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file));
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () =>
      ok({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => {
          for (const r of open) r.destroy();
          server.close();
        },
      })
    );
  });
}

/** A screen's target: `{ role, name?, exact? }` or `{ text, exact? }`. */
function locate(page, t) {
  if (t.role)
    return page
      .getByRole(t.role, { ...(t.name != null ? { name: t.name } : {}), exact: t.exact ?? false })
      .first();
  return page.getByText(t.text, { exact: t.exact ?? false }).first();
}
const describe = (t) =>
  t.role ? `${t.role}${t.name != null ? ` "${t.name}"` : ''}` : `text "${t.text}"`;

/** The page address for a screen in a theme: its query (with the theme) and hash. */
export function screenUrl(base, screen, theme) {
  const q = new URLSearchParams(screen.query ?? '');
  q.set('theme', theme);
  return `${base}/report/?${q.toString()}${screen.hash ?? ''}`;
}

/** Render one screen in one theme; never throws (a failure is the result). */
async function capture(browser, { url, screen, shot, axe, initScript = null }) {
  const started = Date.now();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    reducedMotion: 'reduce',
    colorScheme: url.includes('theme=light') ? 'light' : 'dark',
  });
  const errors = [];
  try {
    await context.addInitScript((css) => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = css;
        document.head.append(s);
      });
    }, FREEZE);
    if (initScript) await context.addInitScript(initScript);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message ?? e).split('\n')[0]));
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await page.goto(url, { waitUntil: 'load' });
    for (const a of screen.actions ?? []) {
      if (a.click) await locate(page, a.click).click({ timeout: LANDMARK_MS });
      else if (a.press) await page.keyboard.press(a.press);
    }
    try {
      await locate(page, screen.wait).waitFor({ state: 'visible', timeout: LANDMARK_MS });
    } catch {
      return {
        rendered: false,
        reason: `landmark missing: ${describe(screen.wait)}`,
        errors,
        axe: [],
        ms: Date.now() - started,
      };
    }
    await page.evaluate(() => document.fonts?.ready);
    mkdirSync(dirname(shot), { recursive: true });
    await page.screenshot({ path: shot });
    let violations = [];
    if (axe) {
      await injectAxe(page, axe);
      violations = await page.evaluate(async () => {
        const r = await window.axe.run(document, { resultTypes: ['violations'] });
        return r.violations.map((v) => ({
          id: v.id,
          impact: v.impact ?? null,
          count: v.nodes.length,
        }));
      });
    }
    if (errors.length)
      return {
        rendered: false,
        reason: `page error: ${errors[0]}`,
        errors,
        axe: violations,
        ms: Date.now() - started,
      };
    return { rendered: true, reason: null, errors, axe: violations, ms: Date.now() - started };
  } catch (e) {
    return {
      rendered: false,
      reason: String(e.message ?? e).split('\n')[0],
      errors,
      axe: [],
      ms: Date.now() - started,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Run `fn` over `items`, `n` at a time, keeping the order of the results. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/** summary.md: the counts, then every screen that failed or has axe violations. */
export function summaryMarkdown(report) {
  const s = report.summary;
  const lines = [
    `## pxsig dashboard check — ${s.failed ? `${s.failed} of ${s.screens} screens failed` : `${s.rendered} of ${s.screens} screens rendered`}`,
    '',
    `Adapter build: \`${report.build}\` · contract ${report.contract.adapter} (this pxsig: ${report.contract.current}) · themes ${report.themes.join(', ')}`,
    `Reference: ${report.reference.used ? `\`${report.reference.dir}\`` : `not shown (${report.reference.note})`}`,
    '',
    '| Screens | Rendered | Failed | With axe violations |',
    '| --- | --- | --- | --- |',
    `| ${s.screens} | ${s.rendered} | ${s.failed} | ${s.withAxe}${report.strict ? ' (strict)' : ' (advisory)'} |`,
  ];
  const bad = report.screens.filter((x) => !x.rendered);
  if (bad.length)
    lines.push(
      '',
      '### Failed',
      '',
      ...bad.map((x) => `- \`${x.feature}\` #${x.index + 1} (${x.theme}): ${x.reason}`)
    );
  const ax = report.screens.filter((x) => x.axe.length);
  if (ax.length)
    lines.push(
      '',
      '### Accessibility',
      '',
      ...ax.map(
        (x) =>
          `- \`${x.feature}\` #${x.index + 1} (${x.theme}): ${x.axe.map((v) => `${v.id} (${v.impact ?? 'n/a'}, ${v.count})`).join(', ')}`
      )
    );
  return `${lines.join('\n')}\n`;
}

/** index.html: each screen on the adapter beside the reference, grouped by feature. */
export function galleryHtml(report) {
  const groups = new Map();
  for (const x of report.screens) groups.set(x.feature, [...(groups.get(x.feature) ?? []), x]);
  const img = (src, alt) =>
    src
      ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`
      : `<p class="none">${esc(alt)}</p>`;
  const sections = [...groups.values()].map((xs) => {
    const f = xs[0];
    const cells = xs
      .map(
        (x) => `<figure class="${x.rendered ? 'ok' : 'bad'}">
  <figcaption>#${x.index + 1} · ${esc(x.theme)} · ${esc(x.scenario)} · ${x.rendered ? 'rendered' : esc(x.reason)}${x.axe.length ? ` · axe: ${esc(x.axe.map((v) => `${v.id} (${v.count})`).join(', '))}` : ''}${x.fallbacks?.length ? ` · fallbacks: ${esc(x.fallbacks.join(', '))}` : ''}</figcaption>
  <div class="pair">${img(x.shot, x.rendered ? 'adapter' : 'not rendered')}${report.reference.used ? img(x.referenceShot, 'reference not rendered') : ''}</div>
</figure>`
      )
      .join('\n');
    return `<section><h2>${esc(f.title)} <code>${esc(f.feature)}</code></h2><p>${esc(f.purpose)}</p><p class="meta">Components: ${esc(f.components.join(', '))}</p>\n${cells}</section>`;
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>pxsig dashboard check</title>
<style>
:root{color-scheme:light dark;font:14px/1.45 system-ui,sans-serif}body{margin:0 auto;padding:1rem;max-inline-size:120rem}
h1{font-size:1.25rem}h2{font-size:1rem;margin-block:2rem .25rem}p{margin-block:.25rem;max-inline-size:80ch}.meta{opacity:.7}
figure{margin:1rem 0;padding:.5rem;border:1px solid color-mix(in srgb,currentColor 20%,transparent)}figure.bad{border-color:#c62828}
figcaption{font-size:.85rem;margin-block-end:.5rem}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(20rem,1fr));gap:.5rem}
.pair img{inline-size:100%;block-size:auto;border:1px solid color-mix(in srgb,currentColor 15%,transparent)}.none{opacity:.7}
</style></head><body>
<h1>pxsig dashboard check</h1>
<p>${esc(report.summary.rendered)} of ${esc(report.summary.screens)} screens rendered · ${esc(report.summary.failed)} failed · ${esc(report.summary.withAxe)} with axe violations${report.strict ? ' (strict)' : ' (advisory)'}.</p>
<p>Left: the adapter build <code>${esc(report.build)}</code>. ${report.reference.used ? 'Right: the prebuilt reference dashboard.' : `No reference column: ${esc(report.reference.note)}.`}</p>
${sections.join('\n')}
</body></html>
`;
}

/**
 * Run the check. Returns `{ code, report, outDir }`; throws CheckSetupError for exit 2.
 * `browser` (tests) skips the launch.
 */
export async function dashboardCheck(
  flags = {},
  cwd = process.cwd(),
  {
    log = (m) => process.stderr.write(`${m}\n`),
    browser: given = null,
    concurrency = 4,
    catalogue: givenCatalogue = null,
    initScript = null,
  } = {}
) {
  const src = dashboardSource();
  const fixtures = await load(src, 'fixtures/scenarios.mjs');
  const catalogue = givenCatalogue ?? readJson(join(src, 'fixtures', 'screens.json'));
  if (!catalogue?.features?.length)
    throw new CheckSetupError(
      `the dashboard's screen list is missing (${join(src, 'fixtures', 'screens.json')})`
    );
  // --only <feature,…>: a part of the check, while working on one feature.
  const only =
    typeof flags.only === 'string'
      ? flags.only
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : null;
  const unknown = (only ?? []).filter((id) => !catalogue.features.some((f) => f.id === id));
  if (unknown.length)
    throw new CheckSetupError(
      `--only names no feature: ${unknown.join(', ')} (features: ${catalogue.features.map((f) => f.id).join(', ')})`
    );
  const features = only
    ? catalogue.features.filter((f) => only.includes(f.id))
    : catalogue.features;

  const build = typeof flags.build === 'string' ? resolve(cwd, flags.build) : buildDirFor(cwd);
  if (!isDashboardBuild(build))
    throw new CheckSetupError(
      `no dashboard build at ${shown(cwd, build)}: run \`pxsig dashboard build\` first, or pass --build <dir>`
    );

  // The adapter, for the contract version and the components it leaves to fallbacks.
  const { resolveAdapter } = await load(src, 'build-config.mjs');
  const { contractStatus, gapsOf, buildManifest, readConformance } = await load(
    src,
    'ui-tools.mjs'
  );
  // --ui, else the adapter the build's stamp names (`pxsig dashboard build` records it), else the
  // project's dashboard.ui. Without any of them the fallbacks column stays empty.
  const stamp = readJson(join(build, STAMP));
  let ui = null;
  try {
    const spec =
      typeof flags.ui === 'string'
        ? flags.ui
        : stamp?.adapter && existsSync(stamp.adapter)
          ? stamp.adapter
          : undefined;
    const { from } = (await load(src, 'build-config.mjs')).adapterSpec({ adapter: spec, cwd });
    if (from !== 'default') ui = resolveAdapter({ adapter: spec, cwd });
  } catch {
    ui = null;
  }
  const contract = contractStatus(
    (ui ? readConformance(ui.dir)?.contract : null) ?? stamp?.adapterContract ?? '1.0.0'
  );
  if (contract.status === 'older-major')
    throw new CheckSetupError(
      [`the adapter is ${contract.line}.`, ...(contract.notes ?? [])].join('\n\n')
    );
  const gapRows = ui ? gapsOf({ adapterFile: ui.file, manifest: buildManifest() }).rows : null;
  const fallback = new Set(
    (gapRows ?? []).filter((r) => r.status === 'missing').map((r) => r.name)
  );

  const refDir =
    typeof flags.reference === 'string' ? resolve(cwd, flags.reference) : prebuiltDashboardDir;
  const reference = { dir: refDir, used: false, note: null };
  if (resolve(refDir) === resolve(build))
    reference.note = 'the build checked is the reference itself';
  else if (!isDashboardBuild(refDir))
    reference.note = existsSync(join(refDir, 'index.html'))
      ? `${refDir} is a placeholder, not a built dashboard`
      : `no prebuilt dashboard at ${refDir}`;
  else reference.used = true;

  const themes =
    typeof flags.themes === 'string'
      ? flags.themes
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : THEMES;
  const bad = themes.filter((x) => !THEMES.includes(x));
  if (bad.length || !themes.length)
    throw new CheckSetupError(`--themes takes dark, light or both (got ${flags.themes})`);

  const outDir =
    typeof flags.out === 'string'
      ? resolve(cwd, flags.out)
      : join(cwd, 'node_modules', '.cache', 'pxsig', 'dashboard-check');
  // Only what this command writes is replaced; anything else in the folder stays.
  for (const f of ['shots', 'index.html', 'report.json', 'summary.md'])
    rmSync(join(outDir, f), { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  let browser = given;
  if (!browser) {
    try {
      browser = await launchBrowser({ root: cwd, workspaceRoot: cwd });
    } catch (e) {
      throw new CheckSetupError(
        `no Chromium for the check (${String(e.message ?? e).split('\n')[0]}): install it with \`npx playwright install chromium\``
      );
    }
  }
  const axe = axeScript({ root: cwd, workspaceRoot: cwd });
  const images = sampleImages();
  const posts = [];
  const servers = new Map();
  const serverFor = async (dir, scenario) => {
    const k = `${dir}\n${scenario}`;
    if (!servers.has(k)) servers.set(k, scenarioServer({ dir, scenario, fixtures, images, posts }));
    return servers.get(k);
  };

  const jobs = [];
  for (const f of features)
    f.screens.forEach((screen, index) => {
      for (const theme of themes) jobs.push({ f, screen, index, theme });
    });
  log(
    `[dashboard] checking ${jobs.length} screens (${features.length} features × ${themes.join(', ')}) on ${shown(cwd, build)}${reference.used ? ', beside the reference' : ''}`
  );
  const name = (j) => `${j.f.id}__${j.index + 1}__${j.theme}.png`;
  let screens;
  try {
    screens = await pool(jobs, concurrency, async (j) => {
      const server = await serverFor(build, j.screen.scenario);
      const shot = join(outDir, 'shots', 'adapter', name(j));
      const r = await capture(browser, {
        url: screenUrl(server.base, j.screen, j.theme),
        screen: j.screen,
        shot,
        axe,
        initScript,
      });
      let referenceShot = null;
      if (reference.used) {
        const rs = await serverFor(refDir, j.screen.scenario);
        const file = join(outDir, 'shots', 'reference', name(j));
        const rr = await capture(browser, {
          url: screenUrl(rs.base, j.screen, j.theme),
          screen: j.screen,
          shot: file,
          axe: '',
        });
        referenceShot = rr.rendered ? `shots/reference/${name(j)}` : null;
      }
      return {
        feature: j.f.id,
        title: j.f.title,
        purpose: j.f.purpose,
        components: j.f.components,
        index: j.index,
        scenario: j.screen.scenario,
        theme: j.theme,
        rendered: r.rendered,
        reason: r.reason,
        errors: r.errors,
        axe: r.axe,
        fallbacks: gapRows ? j.f.components.filter((c) => fallback.has(c)) : null,
        ms: r.ms,
        shot: r.rendered ? `shots/adapter/${name(j)}` : null,
        referenceShot,
      };
    });
  } finally {
    for (const s of servers.values()) (await s).close();
    if (!given) await browser.close().catch(() => {});
  }

  const failed = screens.filter((x) => !x.rendered).length;
  const withAxe = screens.filter((x) => x.axe.length).length;
  const report = {
    pxsig: PXSIG_VERSION,
    build: shown(cwd, build),
    adapter: ui?.name ?? null,
    contract: { current: contract.current, adapter: contract.adapter, status: contract.status },
    reference: { ...reference, dir: shown(cwd, reference.dir) },
    themes,
    strict: Boolean(flags.strict),
    summary: {
      screens: screens.length,
      rendered: screens.length - failed,
      failed,
      withAxe,
      posts: posts.length,
    },
    screens,
  };
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, 'summary.md'), summaryMarkdown(report));
  writeFileSync(join(outDir, 'index.html'), galleryHtml(report));
  const code = failed || (report.strict && withAxe) ? 1 : 0;
  return { code, report, outDir };
}
