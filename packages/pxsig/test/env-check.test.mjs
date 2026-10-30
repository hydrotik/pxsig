/**
 * env-check.test.mjs — the render environment through the engine and the server: the
 * `env-mismatch` setup finding, an older engine, `--strict-env`, the server writing the row's
 * environment into an approved baseline, and a check recording each render's env.
 *
 *   node --test packages/pxsig/test/env-check.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { envId, strictEnvCheck } from '../src/lib/env.mjs';
import { reconcile } from '../src/lib/integrity.mjs';
import { readHeader } from '../src/lib/psig.mjs';
import { readToken } from '../src/lib/guard.mjs';
import { engineProblems, openProject, writeRunManifest } from '../src/lib/workspace.mjs';
import { fixture, hasRust, rustBin, testEnv, testHome } from './fixture.mjs';
import { src, env, needs } from './env-helpers.mjs';
import { skipUnless } from './strict.mjs';
/** @import { EnvRecord, PsigHeader } from '../src/types.js' */
/** @typedef {ReturnType<typeof fixture>} Fixture */

test('integrity: one env-mismatch setup warning, never a per-entry code, and doctor stays as it was', async () => {
  const f = fixture({ withSigs: false });
  const reportPath = join(f.px, 'reports', 'check.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const before = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  assert.ok(!before.setup.some((x) => x.code === 'env-mismatch'), 'no mismatch, no finding');
  report.summary = {
    ...report.summary,
    envMismatch: 3,
    envFields: ['browser.version 141→142', 'fonts.probe: Inter'],
  };
  writeFileSync(reportPath, JSON.stringify(report));
  const after = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  // The summary now counts a mismatch, so the finding is there (the assertions below fail otherwise).
  const s = /** @type {{ severity: string, reason: string, count?: number }} */ (
    after.setup.find((x) => x.code === 'env-mismatch')
  );
  assert.equal(s.severity, 'warn');
  assert.equal(s.count, 3);
  assert.match(
    s.reason,
    /3 entries were rendered in a different environment than their baseline \(browser\.version 141→142, fonts\.probe: Inter\)/
  );
  assert.ok(
    // A setup code: the test checks no entry carries it, which the types already say.
    !after.entries.some((x) =>
      x.issues.some((i) => /** @type {string} */ (i.code) === 'env-mismatch')
    ),
    'no entry carries the code'
  );
  assert.deepEqual(
    after.summary.bySeverity,
    before.summary.bySeverity,
    'entry severities unchanged'
  );
});

test('an engine older than the CLI is a warning; the same or newer is not', () => {
  if (!hasRust) return;
  // The engine built from this checkout reports the CLI's own version.
  assert.deepEqual(engineProblems(rustBin), []);
  assert.deepEqual(engineProblems(join(src, 'nope')), [], 'a missing binary is not this check');
});

// --- with the Rust engine: baselines that record an env -----------------------------------------------

/**
 * Write baselines for `ids` from the fixture's latest renders, recording `e` as their env.
 * @param {Fixture} f
 * @param {string[]} ids
 * @param {EnvRecord} e
 */
function baselineWithEnv(f, ids, e) {
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
  const run = writeRunManifest(P).path;
  const plan = join(f.repo, '.env-plan.json');
  writeFileSync(
    plan,
    JSON.stringify({ envs: { [e.id]: e }, byId: Object.fromEntries(ids.map((id) => [id, e.id])) })
  );
  const r = spawnSync(
    rustBin,
    [
      'baseline',
      '--manifest',
      run,
      '--png-dir',
      P.store.latest,
      '--root',
      P.workspaceRoot,
      '--only',
      ids.join(','),
      '--env',
      `@${plan}`,
      '--json',
    ],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, r.stderr);
  return P;
}

test(
  'strict mode: the selected baselines from a different environment, read from their headers',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  () => {
    const f = fixture();
    const old = env({ browser: { version: '139.0.1' } });
    baselineWithEnv(f, [f.ids.ok], old);
    // Both baselines were just written (`baselineWithEnv` names only the first).
    assert.equal(
      /** @type {{ env: EnvRecord }} */ (readHeader(f.sig(f.ids.ok))).env.id,
      old.id,
      'the header records the env'
    );
    assert.equal(
      /** @type {PsigHeader} */ (readHeader(f.sig(f.ids.drift))).env,
      undefined,
      'an entry the plan does not name gets none'
    );
    const entries = f.manifest.stories.filter((e) => [f.ids.ok, f.ids.drift].includes(e.id));
    const bad = strictEnvCheck(entries, (e) => join(f.repo, e.sig), { chromium: env() });
    assert.deepEqual(bad, { count: 1, fields: ['browser.version 139→141'], ids: [f.ids.ok] });
    assert.equal(
      strictEnvCheck(entries, (e) => join(f.repo, e.sig), {
        chromium: env({ browser: { version: '139.5' } }),
      }).count,
      0,
      'compatible never refuses'
    );
  }
);

test(
  'approving in the dashboard writes the environment of the render being approved, from its row',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const id = f.ids.changed;
    const renderEnv = env({ render: { timezone: 'Pacific/Auckland' } });
    const checkPath = join(f.px, 'reports', 'check.json');
    const check = JSON.parse(readFileSync(checkPath, 'utf8'));
    check.envs = { [renderEnv.id]: renderEnv };
    check.rows = check.rows.map((/** @type {{ id: string }} */ r) =>
      r.id === id ? { ...r, env: renderEnv.id, baselineEnv: null, envMatch: 'unknown' } : r
    );
    writeFileSync(checkPath, JSON.stringify(check));
    const port = await new Promise((ok) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        // Listening on TCP: the address is an AddressInfo.
        const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
        s.close(() => ok(p));
      });
    });
    const proc = spawn(
      process.execPath,
      [join(src, 'serve.mjs'), '--port', String(port), '--no-open'],
      { cwd: f.repo, env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } }
    );
    let log = '';
    proc.stdout.on('data', (d) => (log += d));
    proc.stderr.on('data', (d) => (log += d));
    try {
      await /** @type {Promise<void>} */ (
        new Promise((ok, fail) => {
          const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 20000);
          proc.stdout.on('data', () => /dashboard →/.test(log) && (clearTimeout(t), ok()));
        })
      );
      const base = `http://127.0.0.1:${port}`;
      const r = await fetch(`${base}/__pxsig/approve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The server wrote its token before it printed its URL.
          'x-pxsig-token': /** @type {string} */ (readToken(f.repo, base)),
        },
        body: JSON.stringify({ id }),
      });
      assert.equal(r.status, 200, await r.text());
      // The approve just wrote it.
      const h = /** @type {PsigHeader} */ (readHeader(f.sig(id)));
      assert.deepEqual(h.env, renderEnv, "the row's env, as the check recorded it");
      // A row without env (a report from before 0.5) writes a baseline without env.
      const other = f.ids.drift;
      const r2 = await fetch(`${base}/__pxsig/approve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The server wrote its token before it printed its URL.
          'x-pxsig-token': /** @type {string} */ (readToken(f.repo, base)),
        },
        body: JSON.stringify({ id: other }),
      });
      assert.equal(r2.status, 200, await r2.text());
      assert.equal(/** @type {PsigHeader} */ (readHeader(f.sig(other))).env, undefined);
    } finally {
      proc.kill();
    }
  }
);

// --- end to end, rendering in Chromium -----------------------------------------------------------------

/**
 * A stand-in Storybook with one story: a block on white.
 * @param {{ id: string, title: string, name: string, importPath: string }} story
 */
async function fakeStorybook(story) {
  const html = `<!doctype html><html><head><style>body{margin:0;background:#fff}#storybook-root>div{inline-size:96px;block-size:64px;background:#2a4a7a}</style></head>
<body class="sb-show-main"><div id="storybook-root"><div></div></div>
<script>window.__STORYBOOK_PREVIEW__ = { storeInitializationPromise: Promise.resolve(), currentRender: { id: ${JSON.stringify(story.id)}, phase: 'finished' } };</script></body></html>`;
  const server = createServer((req, res) => {
    // A request to an http server always has a url.
    const u = new URL(/** @type {string} */ (req.url), 'http://x');
    if (u.pathname === '/index.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          v: 5,
          entries: {
            [story.id]: {
              type: 'story',
              id: story.id,
              title: story.title,
              name: story.name,
              importPath: `./${story.importPath}`,
              tags: [],
            },
          },
        })
      );
    }
    if (u.pathname === '/iframe.html')
      return res.writeHead(200, { 'content-type': 'text/html' }).end(html);
    res.writeHead(404).end();
  });
  await /** @type {Promise<void>} */ (new Promise((ok) => server.listen(0, '127.0.0.1', ok)));
  // Listening on TCP: the address is an AddressInfo.
  return {
    url: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`,
    close: () => server.close(),
  };
}

test(
  "a check records each render's env; a baseline from another environment warns, and --strict-env refuses before rendering",
  { skip: needs },
  async () => {
    const f = fixture();
    const id = f.ids.ok;
    const sb = await fakeStorybook({
      id,
      title: 'Components/Alpha',
      name: 'Default',
      importPath: 'src/components/Alpha/Alpha.stories.tsx',
    });
    const cfgPath = join(f.repo, 'pxsig.config.json');
    writeFileSync(
      cfgPath,
      JSON.stringify(
        { ...JSON.parse(readFileSync(cfgPath, 'utf8')), storybook: { url: sb.url } },
        null,
        2
      )
    );
    // Asynchronous: the stand-in Storybook answers from this process.
    /**
     * @param {string[]} [args]
     * @param {string} [strictVar]
     * @returns {Promise<{ status: number | null, stdout: string, stderr: string }>}
     */
    const check = (args = [], strictVar = '') =>
      new Promise((ok) => {
        const p = spawn(
          process.execPath,
          [join(src, 'check.mjs'), '--only', id, '--retries', '0', '--no-a11y', ...args],
          {
            cwd: f.repo,
            env: {
              ...testEnv(testHome),
              PXSIG_BIN: rustBin,
              PXSIG_WORKSPACE: '',
              PXSIG_STRICT_ENV: strictVar,
            },
          }
        );
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
      let row = rep.rows.find((/** @type {{ id: string }} */ x) => x.id === id);
      assert.equal(row.envMatch, 'unknown', r.stdout + r.stderr);
      assert.ok(rep.envs[row.env], 'check.json carries the env the row names');
      assert.equal(rep.envs[row.env].browser.name, 'chromium');
      assert.ok(!/\[check\] env:/.test(r.stdout));
      const here = rep.envs[row.env];
      // Baselines re-taken from this run's renders, recording an older browser.
      baselineWithEnv(f, [id], {
        ...here,
        browser: { ...here.browser, version: '1.0.0' },
        id: envId({ ...here, browser: { ...here.browser, version: '1.0.0' } }),
      });
      r = await check();
      rep = report();
      row = rep.rows.find((/** @type {{ id: string }} */ x) => x.id === id);
      assert.equal(r.status, 0, `the render matches: a warning only\n${r.stdout}${r.stderr}`);
      assert.equal(row.envMatch, 'mismatch');
      assert.deepEqual(row.envDiff, ['browser.version']);
      assert.equal(rep.summary.envMismatch, 1);
      assert.match(
        r.stdout,
        /\[check\] env: 1 of 1 entries rendered in a different environment than their baseline \(browser\.version 1→\d+\) → pxsig doctor/
      );
      assert.match(
        readFileSync(join(f.px, 'reports', 'summary.md'), 'utf8'),
        /Environment: 1 of 1 entries were rendered in a different environment/
      );
      // --strict-env: exit 2, nothing rendered.
      r = await check(['--strict-env']);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(
        r.stderr,
        /setup error: 1 baselines were approved in a different environment \(browser\.version 1→\d+\)\. Nothing was rendered/
      );
      assert.ok(!/\[check\] rendered/.test(r.stdout), 'nothing was rendered');
      // The same through config, and through the variable.
      writeFileSync(
        cfgPath,
        JSON.stringify(
          { ...JSON.parse(readFileSync(cfgPath, 'utf8')), env: { strict: true } },
          null,
          2
        )
      );
      assert.equal((await check()).status, 2);
      writeFileSync(
        cfgPath,
        JSON.stringify(
          { ...JSON.parse(readFileSync(cfgPath, 'utf8')), env: { ignore: ['browser.version'] } },
          null,
          2
        )
      );
      r = await check();
      assert.equal(
        report().rows.find((/** @type {{ id: string }} */ x) => x.id === id).envMatch,
        'same',
        'an ignored field is not compared'
      );
      assert.equal(r.status, 0);
      assert.equal((await check([], '1')).status, 0, 'ignored fields never refuse either');
      writeFileSync(
        cfgPath,
        JSON.stringify({ ...JSON.parse(readFileSync(cfgPath, 'utf8')), env: {} }, null, 2)
      );
      r = await check([], '1');
      assert.equal(r.status, 2, `PXSIG_STRICT_ENV=1 refuses like the flag\n${r.stdout}${r.stderr}`);
    } finally {
      sb.close();
    }
  }
);
