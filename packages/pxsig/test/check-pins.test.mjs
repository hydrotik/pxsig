/**
 * check-pins.test.mjs — what `pxsig check` (src/check.mjs) answers today, from a fixture project in
 * a temp dir: the refusals before rendering and their exit codes, the console lines of a run, the
 * report it writes (carried rows, files, the integrity line) and `--changed` / `--sarif`.
 *
 *   node --test packages/pxsig/test/check-pins.test.mjs
 *
 * These pin today's answers so moving check.mjs's stages into modules changes none of them. The
 * refusals need the Rust binary; the runs also need Chromium (a stand-in Storybook serves them).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture, hasRust, rustBin } from './fixture.mjs';
import { fakeStorybook, needs, src } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

/** @typedef {ReturnType<typeof fixture>} Fixture */

const rust = skipUnless(hasRust, 'Rust binary not built');

/**
 * Run check.mjs in the fixture.
 * @param {Fixture} f
 * @param {string[]} args
 * @param {{ bin?: string }} [opts]
 * @returns {Promise<{ code: number | null, out: string, err: string }>}
 */
const check = (f, args, { bin = rustBin } = {}) =>
  new Promise((ok) => {
    const p = spawn(process.execPath, [join(src, 'check.mjs'), ...args], {
      cwd: f.repo,
      env: { ...f.env, PXSIG_BIN: bin, PXSIG_WORKSPACE: '' },
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => ok({ code, out, err }));
  });

/**
 * Point the fixture's storybook.url at `url`.
 * @param {Fixture} f
 * @param {string} url
 */
const useStorybook = (f, url) => {
  const cfgPath = join(f.repo, 'pxsig.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, storybook: { url } }, null, 2));
};

/** @param {Fixture} f */
const reportOf = (f) => JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8'));

test('a missing engine binary is a setup error (exit 2) before anything is read', async (t) => {
  const f = fixture({ withSigs: false, t });
  const r = await check(f, ['--only', f.ids.ok], { bin: join(f.repo, 'no-such-pxsig') });
  assert.equal(r.code, 2, r.err);
  assert.match(
    r.err,
    /^\[check\] the pxsig binary is missing \(.+\): install the platform package, or build it with `cargo build --release`\n$/
  );
  assert.equal(r.out, '');
});

test(
  'a selection that matches nothing is "no entries selected" (exit 2)',
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    const r = await check(f, ['--modes', 'sepia']);
    assert.equal(r.code, 2);
    assert.match(r.out, /^\[check\] project fixture · 15 entries · store \.pxsig\n$/);
    assert.equal(r.err, '[check] no entries selected\n');
  }
);

test(
  'beside a server holding the store, --no-server and --suite refuse; nothing is queued',
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    writeFileSync(
      join(f.px, 'reports', '.lock'),
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), holder: 'serve', command: 'pxsig serve', url: 'http://127.0.0.1:1' })}\n`
    );
    const r = await check(f, ['--only', f.ids.ok, '--no-server']);
    assert.equal(r.code, 2);
    assert.match(
      r.err,
      /^\[check\] the pxsig server at http:\/\/127\.0\.0\.1:1 \(pid \d+, since \S+\) holds the store \.pxsig: this check cannot run beside it\. Approve in the dashboard, or stop the server and run again\.\n$/
    );
    writeFileSync(
      join(f.px, 'manifest.matrix.json'),
      readFileSync(join(f.px, 'manifest.json'), 'utf8')
    );
    const s = await check(f, ['--only', f.ids.ok, '--suite', 'matrix']);
    assert.equal(s.code, 2);
    assert.match(s.err, /: --suite cannot run beside it\./);
  }
);

test(
  'an unreachable Storybook is a setup error (exit 2): nothing rendered, the report untouched',
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    const before = readFileSync(join(f.px, 'reports', 'check.json'), 'utf8');
    const r = await check(f, ['--only', f.ids.ok, '--no-a11y']);
    assert.equal(r.code, 2, r.err);
    assert.match(
      r.err,
      /\[check\] setup error: Storybook is not reachable at http:\/\/127\.0\.0\.1:1 \(.+\); start it, point storybook\.url at a running build, or set storybook\.staticDir to a built Storybook\. Nothing was rendered\.\n$/
    );
    assert.equal(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8'), before);
    assert.ok(!existsSync(join(f.px, 'reports', '.lock')), 'the lock is released on exit');
  }
);

test(
  'a run: its lines, exit 1 on a change, the report with carried rows, summary.md, junit.xml',
  { skip: needs },
  async (t) => {
    const f = fixture({ t });
    const sb = await fakeStorybook(f.index.stories);
    t.after(() => sb.close());
    useStorybook(f, sb.url);
    writeFileSync(join(f.px, 'reports', 'review.json'), '{}');
    const previous = reportOf(f);
    const r = await check(f, ['--only', `${f.ids.ok},${f.ids.drift}`, '--retries', '0']);
    assert.equal(r.code, 1, r.out + r.err);
    const lines = r.out.split('\n').filter((l) => l.startsWith('[check]'));
    const shapes = [
      /^\[check\] project fixture · 15 entries · store \.pxsig$/,
      /^\[check\] rendered 2 entries in \d+\.\d s on 8 pages · \d+ page loads$/,
      /^\[check\] Rust check: 2 entries, 2 failed, \d+ cached · \d+ ms engine \(\d+ ms process\)$/,
      /^\[check\] 2 checked · 0 pass · 2 changed · 0 flaky · 13 skipped · a11y \d+ violations \(\d+ new\) · \d+\.\d s total$/,
      /^\[check\] wrote \.pxsig\/reports\/check\.json, summary\.md, junit\.xml$/,
    ];
    let at = 0;
    for (const re of shapes) {
      const i = lines.findIndex((l, n) => n >= at && re.test(l));
      assert.ok(i >= 0, `${re} after line ${at}:\n${lines.join('\n')}`);
      at = i + 1;
    }
    // The integrity line comes last among [check] lines.
    assert.match(lines.at(-1) ?? '', /^\[check\] .+/);
    assert.match(r.out, new RegExp(`\\n  CHANGED ${f.ids.ok} +\\S`));
    const report = reportOf(f);
    assert.deepEqual(Object.keys(report), [
      'generatedAt',
      'fullCheckAt',
      'project',
      'suite',
      'manifest',
      'summary',
      'affected',
      'envs',
      'rows',
    ]);
    assert.equal(report.project, 'fixture');
    assert.equal(report.suite, null);
    assert.equal(report.affected, null);
    // A partial run keeps the last full check: the previous report's time when it names none.
    assert.equal(report.fullCheckAt, previous.generatedAt);
    assert.equal(report.rows.length, 15);
    assert.deepEqual(
      report.rows.map((/** @type {{ id: string }} */ x) => x.id),
      f.manifest.stories.map((e) => e.id)
    );
    for (const row of report.rows) {
      const was = previous.rows.find((/** @type {{ id: string }} */ x) => x.id === row.id);
      if (row.id === f.ids.ok || row.id === f.ids.drift) {
        assert.equal(row.skipped, undefined, row.id);
        assert.equal(row.pass, false, row.id);
      } else if (was) {
        // The whole previous row, verdict time included, marked as carried.
        assert.deepEqual(row, { ...was, skipped: true, inherited: true }, row.id);
      } else {
        assert.deepEqual(row, {
          id: row.id,
          story: row.id,
          mode: 'dark',
          state: null,
          skipped: true,
          pass: true,
          metrics: null,
          inherited: false,
        });
      }
    }
    assert.equal(report.summary.checked, 2);
    assert.equal(report.summary.skipped, 13);
    for (const name of ['summary.md', 'junit.xml', '.selected.json'])
      assert.ok(existsSync(join(f.px, 'reports', name)), name);
    assert.ok(!existsSync(join(f.px, 'reports', 'review.json')), 'a new run starts clean');
    assert.ok(!existsSync(join(f.px, 'reports', '.lock')));
  }
);

test(
  '--changed selects through the import graph; the rest are carried as unaffected; --sarif writes',
  { skip: needs },
  async (t) => {
    const f = fixture({ t });
    const sb = await fakeStorybook(f.index.stories);
    t.after(() => sb.close());
    useStorybook(f, sb.url);
    const previous = reportOf(f);
    const r = await check(f, [
      '--changed',
      'src/components/Alpha/Alpha.stories.tsx',
      '--retries',
      '0',
      '--sarif',
      'a11y.sarif',
    ]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(
      r.out,
      /\n\[check\] affected by --changed: 1 changed files → 2 entries \(.+\) in \d+ ms\n/
    );
    assert.match(r.out, /\n\[check\] wrote \d+ new a11y violations to a11y\.sarif \(SARIF\)\n/);
    assert.ok(existsSync(join(f.repo, 'a11y.sarif')));
    const report = reportOf(f);
    assert.deepEqual(report.affected.changed, ['src/components/Alpha/Alpha.stories.tsx']);
    assert.deepEqual(new Set(report.affected.ids), new Set([f.ids.ok, f.ids.drift]));
    for (const row of report.rows)
      if (row.id !== f.ids.ok && row.id !== f.ids.drift) {
        assert.equal(row.skipped, true, row.id);
        // Unaffected: carried from the last report, or (no earlier row) only with a baseline.
        const was = previous.rows.some((/** @type {{ id: string }} */ x) => x.id === row.id);
        assert.equal(row.unaffected, was || existsSync(f.sig(row.id)) ? true : undefined, row.id);
      }
    assert.match(report.summary.affected, /^2 affected of 15 \(.+\)$/);
  }
);
