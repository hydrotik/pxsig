/**
 * react-run.test.mjs — one React analysis run end to end (lib/react/index.mjs and `pxsig react`):
 * a git fixture where one component starts to bail out and another gains a finding, under Babel 7
 * and 8; the cache; no worker when nothing needs compiling; the compiler absent; the off switches;
 * a bad value; the store held by another process; and no path or user name in any output.
 *
 *   node --test packages/pxsig/test/react-run.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyse } from '../src/lib/react/index.mjs';
import { reactFindings } from '../src/lib/react/doctor.mjs';
import { hasRust, testEnv, testHome } from './fixture.mjs';
import { BASE, hasCompiler, projectAt, reactProject, write } from './react-helpers.mjs';
import { skipUnless } from './strict.mjs';

/** @import { ReactRun } from '../src/types/react.js' */

const skip = skipUnless(
  hasRust && hasCompiler,
  'the engine or the React Compiler test fixtures are missing'
);
const cli = fileURLToPath(new URL('../bin/pxsig.mjs', import.meta.url));

/**
 * @param {ReactRun} r
 * @returns {Extract<ReactRun, { ran: true }>}
 */
const ran = (r) => {
  assert.ok(r.ran, JSON.stringify(r));
  return r;
};

for (const babel of /** @type {const} */ ([7, 8]))
  test(
    `a component that starts to bail out and a new finding alert, under Babel ${babel}; the second run is cached`,
    { skip },
    async (t) => {
      const dir = reactProject(t, { babel });
      const P = projectAt(dir);
      const r = ran(await analyse(P, { workers: 2 }));
      assert.equal(r.saved, '.pxsig/reports/react.json');
      assert.equal(r.compiled, 2);
      assert.equal(r.workers, 2);
      const rep = r.report;
      assert.equal(rep.backend.name, 'babel');
      assert.equal(rep.backend.babel?.split('.')[0], String(babel));
      assert.equal(rep.base?.since, 'main');
      assert.deepEqual(
        rep.alerts.map((a) => [a.id, a.change, a.level]),
        [
          ['src/Button/Button.tsx#Button', 'new-bailout', 'warning'],
          ['src/Button/Button.tsx#Card', 'new-finding', 'note'],
        ]
      );
      assert.equal(
        rep.alerts[0].text,
        'Button (src/Button/Button.tsx): compiled at main, skipped now: Cannot access refs during render (refs, line 4). Reaches 2 entries.'
      );
      assert.match(rep.alerts[1].text, /\(set-state-in-effect, line 9\)\. It still compiles\.$/);
      assert.deepEqual(
        [rep.summary.newBailouts, rep.summary.newFindings, rep.summary.cached],
        [1, 1, 0]
      );
      const again = ran(await analyse(P));
      assert.deepEqual([again.compiled, again.workers, again.report.summary.cached], [0, 0, 2]);
      assert.deepEqual(again.report.alerts, rep.alerts);
    }
  );

test('nothing to compile: no worker; nothing changed: no file', { skip }, async (t) => {
  const same = reactProject(t, { head: BASE });
  const r = ran(await analyse(projectAt(same)));
  assert.deepEqual([r.report.files.length, r.compiled, r.workers], [0, 0, 0]);
  // A change outside the React files: still no worker.
  const dir = reactProject(t, { head: BASE });
  write(dir, 'README.md', 'x\n');
  const r2 = ran(await analyse(projectAt(dir)));
  assert.deepEqual([r2.compiled, r2.workers], [0, 0]);
  // --files and --all.
  const f = ran(await analyse(projectAt(dir), { files: ['src/Button/Button.tsx'] }));
  assert.equal(f.report.base?.since, 'HEAD');
  const all = ran(await analyse(projectAt(dir), { all: true }));
  assert.equal(all.report.base, null);
  assert.deepEqual(all.report.alerts, []);
  assert.equal(all.report.summary.compiled, 2);
});

test('the compiler or Babel absent: one line, nothing run', { skip }, async (t) => {
  const none = reactProject(t, { babel: null });
  const r = await analyse(projectAt(none));
  assert.deepEqual(r, {
    ran: false,
    why: 'not-installed',
    text: 'react: babel-plugin-react-compiler and @babel/core are not installed in this project: compiler analysis skipped (react.compiler: false hides this line)',
  });
  const dir = reactProject(t);
  rmSync(join(dir, 'node_modules', '@babel'), { recursive: true });
  const babelOnly = await analyse(projectAt(dir));
  assert.ok(
    !babelOnly.ran && babelOnly.text.startsWith('react: @babel/core is not installed'),
    JSON.stringify(babelOnly)
  );
  assert.ok(!existsSync(join(dir, '.pxsig', 'reports', 'react.json')));
});

test('off switches and a bad value: nothing run, never an error', { skip }, async (t) => {
  const dir = reactProject(t, { config: { react: false } });
  assert.deepEqual(await analyse(projectAt(dir)), {
    ran: false,
    why: 'off',
    text: 'react: off (react: false in pxsig.config.json)',
  });
  const on = reactProject(t);
  assert.equal((await analyse(projectAt(on), { flags: { 'no-react': true } })).ran, false);
  assert.deepEqual(await analyse(projectAt(on), { env: { ...process.env, PXSIG_REACT: 'off' } }), {
    ran: false,
    why: 'off',
    text: 'react: off (PXSIG_REACT=off)',
  });
  for (const compiler of [false, 'off']) {
    const d = reactProject(t, { config: { react: { compiler } } });
    assert.deepEqual(await analyse(projectAt(d)), {
      ran: false,
      why: 'off',
      text: 'react: compiler analysis is off (react.compiler: false)',
    });
  }
  const bad = reactProject(t, { config: { react: { target: '20' } } });
  const r = await analyse(projectAt(bad));
  assert.deepEqual(r, {
    ran: false,
    why: 'config',
    text: '[pxsig] react.target must be "17", "18", "19" or "auto": compiler analysis is off for this run',
  });
  assert.deepEqual(
    reactFindings(projectAt(bad)).map((f) => [f.code, f.severity]),
    [['react-config', 'warn']]
  );
  assert.deepEqual(
    reactFindings(projectAt(on)).map((f) => [f.code, f.text]),
    [
      [
        'react-compiler',
        'babel-plugin-react-compiler 1.0.0 with @babel/core 7.29.7: react.compiler is "auto", which uses the project\'s Babel plugin',
      ],
    ]
  );
});

test(
  'the store held by another process: compared from the cache, nothing written',
  { skip },
  async (t) => {
    const dir = reactProject(t);
    const P = projectAt(dir);
    mkdirSync(P.store.reports, { recursive: true });
    // A live holder: the test runner's parent process.
    writeFileSync(
      join(P.store.reports, '.lock'),
      JSON.stringify({
        pid: process.ppid,
        startedAt: new Date().toISOString(),
        host: hostname(),
        holder: 'serve',
        command: 'pxsig serve',
        url: 'http://127.0.0.1:1',
      })
    );
    const r = ran(await analyse(P));
    assert.equal(r.saved, null);
    assert.match(String(r.heldBy), /^the pxsig server at http:\/\/127\.0\.0\.1:1 \(pid \d+/);
    assert.equal(r.report.alerts.length, 2);
    assert.deepEqual(readdirSync(P.store.reports), ['.lock']);
    assert.ok(!existsSync(join(P.store.cache, 'react')));
  }
);

test(
  'pxsig react: text, --json, exit 0 with alerts, usage errors exit 2; no path or user name anywhere',
  { skip },
  async (t) => {
    // A folder named like a person's, under the temp folder.
    const dir = reactProject(t, { folder: 'Jose Nunez' });
    const user = userInfo().username;
    /** @param {string[]} args */
    const run = (args) =>
      spawnSync(process.execPath, [cli, 'react', ...args], {
        cwd: dir,
        encoding: 'utf8',
        env: testEnv(testHome, { PXSIG_FORMAT: 'plain', PXSIG_NO_DELEGATE: '1' }),
      });
    const text = run([]);
    assert.equal(text.status, 0, text.stderr);
    assert.match(
      text.stdout,
      /react: 1 files, 2 functions · 1 newly skipped by the React Compiler · 1 new findings · \d+\.\d s/
    );
    assert.match(
      text.stdout,
      /- Button \(src\/Button\/Button\.tsx\): compiled at main, skipped now/
    );
    const json = run(['--json']);
    assert.equal(json.status, 0, json.stderr);
    const rep = JSON.parse(json.stdout);
    assert.equal(rep.summary.cached, 2);
    assert.equal(run(['--since', 'main', '--all']).status, 2);
    assert.equal(run(['--files']).status, 2);
    // Every output: text, JSON, the report and every file of the run.
    const run_ = join(dir, '.pxsig', 'reports', '.run');
    const outputs = [
      text.stdout,
      text.stderr,
      json.stdout,
      readFileSync(join(dir, '.pxsig', 'reports', 'react.json'), 'utf8'),
      ...readdirSync(run_)
        .filter((f) => f.startsWith('react-'))
        .map((f) => readFileSync(join(run_, f), 'utf8')),
    ];
    for (const o of outputs) {
      assert.ok(!o.includes(dir), 'the absolute path');
      assert.ok(!o.includes('Jose Nunez'), 'the folder named like a person');
      if (user.length > 3) assert.ok(!o.includes(user), 'the user name');
    }
    // A ref that is not a commit: the engine fails, which is one line, never an exit code.
    const nope = run(['--since', 'nope']);
    assert.equal(nope.status, 0);
    assert.match(
      nope.stdout,
      /react: analysis failed \(the engine's react-plan exited with 2\): nothing compared/
    );
  }
);
