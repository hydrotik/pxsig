/**
 * env.test.mjs — the render environment (lib/env.mjs): what is collected (and what never is), the
 * compare classes, `env.ignore`, the rows and summary a check writes, the `env-mismatch` setup
 * finding, the server writing the row's environment into an approved baseline, and
 * `--strict-env` refusing before anything renders.
 *
 *   node --test packages/pxsig/test/env.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { annotateRow, collectEnv, compareEnv, describeDiff, envConfig, envId, envLine, envSummary, gpuClass, strictEnvCheck } from '../src/lib/env.mjs';
import { reconcile } from '../src/lib/integrity.mjs';
import { readHeader } from '../src/lib/psig.mjs';
import { readToken } from '../src/lib/guard.mjs';
import { engineProblems, openProject, writeRunManifest } from '../src/lib/workspace.mjs';
import { fixture, hasRust, rustBin } from './fixture.mjs';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** A complete env, as collectEnv writes one; `over` replaces parts. */
function env(over = {}) {
  const e = {
    v: 1,
    browser: { name: 'chromium', version: '141.0.7390.37', channel: null, launchArgs: [] },
    playwright: '1.58.2',
    os: { platform: 'linux', arch: 'x64', release: '6.8.0', distro: 'Ubuntu 24.04 LTS' },
    fonts: { probe: { digest: 'd1', families: { serif: 'aaaaaaaa', 'sans-serif': 'bbbbbbbb', monospace: 'cccccccc', 'system-ui': 'dddddddd' } }, system: 'f1' },
    render: { dpr: 1, gpu: 'swiftshader', colorGamut: 'srgb', timezone: 'UTC', locale: 'en-US', reducedMotion: 'reduce' },
    capture: { pipeline: 1 },
    container: null,
    pxsig: '0.5.0',
    engine: '0.5.0',
    node: 'v22.18.0',
  };
  for (const [k, v] of Object.entries(over)) e[k] = v && typeof v === 'object' && !Array.isArray(v) && e[k] && typeof e[k] === 'object' ? { ...e[k], ...v } : v;
  e.id = envId(e);
  return e;
}

test('compare classes, from a table of pairs', () => {
  const base = env();
  const cases = [
    [env(), 'same', undefined],
    [env({ node: 'v24.1.0', pxsig: '0.5.1', playwright: '1.59.0' }), 'compatible', ['playwright', 'pxsig', 'node']],
    [env({ browser: { version: '141.0.7390.99' } }), 'compatible', ['browser.version']],
    [env({ os: { release: '6.9.1', distro: 'Debian 12' } }), 'compatible', ['os.release', 'os.distro']],
    [env({ fonts: { system: 'f2' } }), 'compatible', ['fonts.system']],
    [env({ container: { image: 'ghcr.io/hydrotik/pxsig', revision: 'r1', digest: null } }), 'compatible', ['container.image', 'container.revision']],
    [env({ browser: { version: '142.0.7444.10' } }), 'mismatch', ['browser.version']],
    [env({ browser: { channel: 'chrome' } }), 'mismatch', ['browser.channel']],
    [env({ os: { platform: 'darwin' } }), 'mismatch', ['os.platform']],
    [env({ render: { gpu: 'angle-metal' } }), 'mismatch', ['render.gpu']],
    [env({ render: { timezone: 'America/New_York' } }), 'mismatch', ['render.timezone']],
    [env({ capture: { pipeline: 2 } }), 'mismatch', ['capture.pipeline']],
  ];
  for (const [cur, match, diff] of cases) {
    const c = compareEnv(base, cur);
    assert.equal(c.match, match, JSON.stringify(diff));
    assert.deepEqual(c.diff, diff);
  }
  assert.deepEqual(compareEnv(null, base), { match: 'unknown' }, 'a baseline without env is unknown');
  assert.deepEqual(compareEnv(undefined, base), { match: 'unknown' });
});

test('a font difference names the family; env.ignore leaves fields out', () => {
  const base = env();
  const cur = env({ fonts: { probe: { digest: 'd2', families: { ...base.fonts.probe.families, 'sans-serif': 'eeeeeeee', Inter: '12345678' } } } });
  const c = compareEnv(base, cur);
  assert.equal(c.match, 'mismatch');
  assert.deepEqual(c.fonts, ['Inter', 'sans-serif']);
  assert.deepEqual(describeDiff(base, cur, c), ['fonts.probe: Inter, sans-serif']);
  const tz = env({ render: { timezone: 'Asia/Tokyo' } });
  assert.equal(compareEnv(base, tz, ['render.timezone']).match, 'same', 'an ignored field is not compared');
  assert.equal(compareEnv(base, env({ render: { timezone: 'Asia/Tokyo', locale: 'ja-JP' } }), ['render.timezone']).match, 'mismatch');
  assert.deepEqual(describeDiff(base, env({ browser: { version: '142.1' } }), { diff: ['browser.version'] }), ['browser.version 141→142']);
  assert.deepEqual(envConfig({ env: { ignore: ['render.locale'], fontProbe: ['Inter'], strict: true } }), { ignore: ['render.locale'], fontProbe: ['Inter'], strict: true });
  assert.deepEqual(envConfig({}), { ignore: [], fontProbe: [], strict: false });
});

test('the id covers the major fields only', () => {
  assert.equal(env().id, env({ node: 'v99', pxsig: '9.9.9', os: { release: 'x' }, fonts: { system: null } }).id);
  assert.equal(env().id, env({ browser: { version: '141.9.9' } }).id, 'the minor part of the browser version');
  assert.notEqual(env().id, env({ browser: { version: '142.0' } }).id);
  assert.notEqual(env().id, env({ render: { locale: 'de-DE' } }).id);
  assert.match(env().id, /^[0-9a-f]{16}$/);
});

test('the GPU becomes a class; the renderer string is never kept', () => {
  assert.equal(gpuClass('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'swiftshader');
  assert.equal(gpuClass('ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)'), 'angle-metal');
  assert.equal(gpuClass('ANGLE (NVIDIA, Vulkan 1.3.277 (NVIDIA GeForce RTX 4090))'), 'angle-vulkan');
  assert.equal(gpuClass('ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)'), 'angle-gl');
  assert.equal(gpuClass(''), 'masked');
  assert.equal(gpuClass(null), 'none');
});

/** A Playwright Browser stand-in: the probe page answers with fixed facts. */
function stubBrowser({ renderer = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)' } = {}) {
  let closed = 0;
  const page = {
    setContent: async () => {},
    evaluate: async (fn, arg) => (arg?.families ? { widths: Object.fromEntries(arg.families.map((f) => [f, [10, 13.333, 26.667]])), renderer, colorGamut: 'p3', timezone: 'Europe/London', locale: 'en-GB' } : null),
  };
  return {
    version: () => '141.0.7390.37',
    browserType: () => ({ name: () => 'chromium' }),
    newContext: async (opts) => {
      assert.equal(opts.deviceScaleFactor, 1);
      assert.equal(opts.reducedMotion, 'reduce');
      return { newPage: async () => page, close: async () => closed++ };
    },
    closed: () => closed,
  };
}

test('the collector: every field, a stable id, and nothing that names the machine or a person', async () => {
  const b = stubBrowser();
  const e = await collectEnv(b, { channel: 'chrome', fontProbe: ['Inter'], playwright: '1.58.2', pxsig: '0.5.0', engine: '0.5.0', env: { PXSIG_IMAGE: 'ghcr.io/hydrotik/pxsig', PXSIG_IMAGE_REVISION: 'abc' } });
  assert.equal(b.closed(), 1, 'the probe context is closed');
  assert.equal(e.v, 1);
  assert.deepEqual(e.browser, { name: 'chromium', version: '141.0.7390.37', channel: 'chrome', launchArgs: [] });
  assert.equal(e.render.gpu, 'angle-metal');
  assert.deepEqual(Object.keys(e.fonts.probe.families).sort(), ['Inter', 'monospace', 'sans-serif', 'serif', 'system-ui']);
  assert.ok(Object.values(e.fonts.probe.families).every((d) => /^[0-9a-f]{8}$/.test(d)));
  assert.deepEqual(e.container, { image: 'ghcr.io/hydrotik/pxsig', revision: 'abc', digest: null });
  assert.equal(e.capture.pipeline, 1);
  assert.equal(e.id, envId(e));
  const text = JSON.stringify(e);
  assert.ok(!text.includes('Apple M3'), 'the GPU model string is not kept');
  assert.ok(!text.includes(hostname()), 'no host name');
  const user = (() => { try { return userInfo().username; } catch { return null; } })();
  if (user && user.length > 3) assert.ok(!text.includes(user), 'no user name');
  for (const k of ['hostname', 'host', 'user', 'username', 'email', 'home']) assert.ok(!(k in e) && !(k in e.os), `no ${k}`);
  const again = await collectEnv(stubBrowser(), { channel: 'chrome', fontProbe: ['Inter'] });
  assert.equal(again.id, e.id, 'the same facts give the same id');
});

test('rows and the summary: envMatch per row, a count, and a line only when something mismatches', () => {
  const base = env();
  const cur = env({ browser: { version: '142.0.1' } });
  const envs = { [base.id]: base, [cur.id]: cur };
  const current = { chromium: cur };
  const rows = [
    annotateRow({ id: 'a', browser: 'chromium', pass: true, baselineEnv: base.id }, { current, envs }),
    annotateRow({ id: 'b', browser: 'chromium', pass: true, baselineEnv: null }, { current, envs }),
    annotateRow({ id: 'c', skipped: true }, { current, envs }),
    annotateRow({ id: 'd', browser: 'chromium', pass: true, baselineEnv: cur.id }, { current, envs }),
  ];
  assert.equal(rows[0].envMatch, 'mismatch');
  assert.deepEqual(rows[0].envDiff, ['browser.version']);
  assert.equal(rows[0].env, cur.id);
  assert.equal(rows[1].envMatch, 'unknown', 'no baseline env: unknown');
  assert.equal(rows[2].envMatch, undefined, 'a carried row is left as it is');
  assert.equal(rows[3].envMatch, 'same');
  assert.equal(rows[3].envDiff, undefined);
  const s = envSummary(rows, envs);
  assert.deepEqual(s, { envMismatch: 1, envFields: ['browser.version 141→142'] });
  assert.equal(envLine(s, 3), 'env: 1 of 3 entries rendered in a different environment than their baseline (browser.version 141→142) → pxsig doctor');
  assert.deepEqual(envSummary(rows.slice(1), envs), { envMismatch: 0 });
  assert.equal(envLine({ envMismatch: 0 }, 3), null);
});

test('integrity: one env-mismatch setup warning, never a per-entry code, and doctor stays as it was', async () => {
  const f = fixture({ withSigs: false });
  const reportPath = join(f.px, 'reports', 'check.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const before = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  assert.ok(!before.setup.some((x) => x.code === 'env-mismatch'), 'no mismatch, no finding');
  report.summary = { ...report.summary, envMismatch: 3, envFields: ['browser.version 141→142', 'fonts.probe: Inter'] };
  writeFileSync(reportPath, JSON.stringify(report));
  const after = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const s = after.setup.find((x) => x.code === 'env-mismatch');
  assert.equal(s.severity, 'warn');
  assert.equal(s.count, 3);
  assert.match(s.reason, /3 entries were rendered in a different environment than their baseline \(browser\.version 141→142, fonts\.probe: Inter\)/);
  assert.ok(!after.entries.some((x) => x.issues.some((i) => i.code === 'env-mismatch')), 'no entry carries the code');
  assert.deepEqual(after.summary.bySeverity, before.summary.bySeverity, 'entry severities unchanged');
});

test('an engine older than the CLI is a warning; the same or newer is not', () => {
  if (!hasRust) return;
  // The engine built from this checkout reports the CLI's own version.
  assert.deepEqual(engineProblems(rustBin), []);
  assert.deepEqual(engineProblems(join(src, 'nope')), [], 'a missing binary is not this check');
});

// --- with the Rust engine: baselines that record an env -----------------------------------------------

/** Write baselines for `ids` from the fixture's latest renders, recording `e` as their env. */
function baselineWithEnv(f, ids, e) {
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
  const run = writeRunManifest(P).path;
  const plan = join(f.repo, '.env-plan.json');
  writeFileSync(plan, JSON.stringify({ envs: { [e.id]: e }, byId: Object.fromEntries(ids.map((id) => [id, e.id])) }));
  const r = spawnSync(rustBin, ['baseline', '--manifest', run, '--png-dir', P.store.latest, '--root', P.workspaceRoot, '--only', ids.join(','), '--env', `@${plan}`, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return P;
}

test('strict mode: the selected baselines from a different environment, read from their headers', { skip: !hasRust && 'Rust binary not built' }, () => {
  const f = fixture();
  const old = env({ browser: { version: '139.0.1' } });
  baselineWithEnv(f, [f.ids.ok], old);
  assert.equal(readHeader(f.sig(f.ids.ok)).env.id, old.id, 'the header records the env');
  assert.equal(readHeader(f.sig(f.ids.drift)).env, undefined, 'an entry the plan does not name gets none');
  const entries = f.manifest.stories.filter((e) => [f.ids.ok, f.ids.drift].includes(e.id));
  const bad = strictEnvCheck(entries, (e) => join(f.repo, e.sig), { chromium: env() });
  assert.deepEqual(bad, { count: 1, fields: ['browser.version 139→141'], ids: [f.ids.ok] });
  assert.equal(strictEnvCheck(entries, (e) => join(f.repo, e.sig), { chromium: env({ browser: { version: '139.5' } }) }).count, 0, 'compatible never refuses');
});

test("approving in the dashboard writes the environment of the render being approved, from its row", { skip: !hasRust && 'Rust binary not built' }, async () => {
  const f = fixture();
  const id = f.ids.changed;
  const renderEnv = env({ render: { timezone: 'Pacific/Auckland' } });
  const checkPath = join(f.px, 'reports', 'check.json');
  const check = JSON.parse(readFileSync(checkPath, 'utf8'));
  check.envs = { [renderEnv.id]: renderEnv };
  check.rows = check.rows.map((r) => (r.id === id ? { ...r, env: renderEnv.id, baselineEnv: null, envMatch: 'unknown' } : r));
  writeFileSync(checkPath, JSON.stringify(check));
  const port = await new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });
  const proc = spawn(process.execPath, [join(src, 'serve.mjs'), '--port', String(port), '--no-open'], { cwd: f.repo, env: { ...process.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    await new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 20000);
      proc.stdout.on('data', () => /dashboard →/.test(log) && (clearTimeout(t), ok()));
    });
    const base = `http://127.0.0.1:${port}`;
    const r = await fetch(`${base}/__pxsig/approve`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pxsig-token': readToken(f.repo, base) }, body: JSON.stringify({ id }) });
    assert.equal(r.status, 200, await r.text());
    const h = readHeader(f.sig(id));
    assert.deepEqual(h.env, renderEnv, "the row's env, as the check recorded it");
    // A row without env (a report from before 0.5) writes a baseline without env.
    const other = f.ids.drift;
    const r2 = await fetch(`${base}/__pxsig/approve`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pxsig-token': readToken(f.repo, base) }, body: JSON.stringify({ id: other }) });
    assert.equal(r2.status, 200, await r2.text());
    assert.equal(readHeader(f.sig(other)).env, undefined);
  } finally {
    proc.kill();
  }
});

// --- end to end, rendering in Chromium -----------------------------------------------------------------

let chromium = false;
try {
  const pw = await import('playwright');
  await (await pw.chromium.launch()).close();
  chromium = true;
} catch {
  chromium = false;
}
const needs = !hasRust ? 'Rust binary not built' : !chromium ? 'no Chromium' : false;

/** A stand-in Storybook with one story: a block on white. */
async function fakeStorybook(story) {
  const html = `<!doctype html><html><head><style>body{margin:0;background:#fff}#storybook-root>div{inline-size:96px;block-size:64px;background:#2a4a7a}</style></head>
<body class="sb-show-main"><div id="storybook-root"><div></div></div>
<script>window.__STORYBOOK_PREVIEW__ = { storeInitializationPromise: Promise.resolve(), currentRender: { id: ${JSON.stringify(story.id)}, phase: 'finished' } };</script></body></html>`;
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/index.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ v: 5, entries: { [story.id]: { type: 'story', id: story.id, title: story.title, name: story.name, importPath: `./${story.importPath}`, tags: [] } } }));
    }
    if (u.pathname === '/iframe.html') return res.writeHead(200, { 'content-type': 'text/html' }).end(html);
    res.writeHead(404).end();
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('a check records each render\'s env; a baseline from another environment warns, and --strict-env refuses before rendering', { skip: needs }, async () => {
  const f = fixture();
  const id = f.ids.ok;
  const sb = await fakeStorybook({ id, title: 'Components/Alpha', name: 'Default', importPath: 'src/components/Alpha/Alpha.stories.tsx' });
  const cfgPath = join(f.repo, 'pxsig.config.json');
  writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(readFileSync(cfgPath, 'utf8')), storybook: { url: sb.url } }, null, 2));
  // Asynchronous: the stand-in Storybook answers from this process.
  const check = (args = [], strictVar = '') =>
    new Promise((ok) => {
      const p = spawn(process.execPath, [join(src, 'check.mjs'), '--only', id, '--retries', '0', '--no-a11y', ...args], { cwd: f.repo, env: { ...process.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '', PXSIG_STRICT_ENV: strictVar } });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => (stdout += d));
      p.stderr.on('data', (d) => (stderr += d));
      p.on('close', (status) => ok({ status, stdout, stderr }));
    });
  const report = () => JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8'));
  try {
    // First run: the fixture's baseline has no env (unknown, never a warning).
    let r = await check();
    let rep = report();
    let row = rep.rows.find((x) => x.id === id);
    assert.equal(row.envMatch, 'unknown', r.stdout + r.stderr);
    assert.ok(rep.envs[row.env], 'check.json carries the env the row names');
    assert.equal(rep.envs[row.env].browser.name, 'chromium');
    assert.ok(!/\[check\] env:/.test(r.stdout));
    const here = rep.envs[row.env];
    // Baselines re-taken from this run's renders, recording an older browser.
    baselineWithEnv(f, [id], { ...here, browser: { ...here.browser, version: '1.0.0' }, id: envId({ ...here, browser: { ...here.browser, version: '1.0.0' } }) });
    r = await check();
    rep = report();
    row = rep.rows.find((x) => x.id === id);
    assert.equal(r.status, 0, `the render matches: a warning only\n${r.stdout}${r.stderr}`);
    assert.equal(row.envMatch, 'mismatch');
    assert.deepEqual(row.envDiff, ['browser.version']);
    assert.equal(rep.summary.envMismatch, 1);
    assert.match(r.stdout, /\[check\] env: 1 of 1 entries rendered in a different environment than their baseline \(browser\.version 1→\d+\) → pxsig doctor/);
    assert.match(readFileSync(join(f.px, 'reports', 'summary.md'), 'utf8'), /Environment: 1 of 1 entries were rendered in a different environment/);
    // --strict-env: exit 2, nothing rendered.
    r = await check(['--strict-env']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /setup error: 1 baselines were approved in a different environment \(browser\.version 1→\d+\)\. Nothing was rendered/);
    assert.ok(!/\[check\] rendered/.test(r.stdout), 'nothing was rendered');
    // The same through config, and through the variable.
    writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(readFileSync(cfgPath, 'utf8')), env: { strict: true } }, null, 2));
    assert.equal((await check()).status, 2);
    writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(readFileSync(cfgPath, 'utf8')), env: { ignore: ['browser.version'] } }, null, 2));
    r = await check();
    assert.equal(report().rows.find((x) => x.id === id).envMatch, 'same', 'an ignored field is not compared');
    assert.equal(r.status, 0);
    assert.equal((await check([], '1')).status, 0, 'ignored fields never refuse either');
    writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(readFileSync(cfgPath, 'utf8')), env: {} }, null, 2));
    r = await check([], '1');
    assert.equal(r.status, 2, `PXSIG_STRICT_ENV=1 refuses like the flag\n${r.stdout}${r.stderr}`);
  } finally {
    sb.close();
  }
});
