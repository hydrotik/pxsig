/**
 * check-react.test.mjs — React in `pxsig check` (check/react.mjs): a fixture where every alert
 * fires (a component the compiler skips now, a new finding, an entry still committing at capture)
 * gives the terminal lines, check.json's `react`, the history counts, the summary.md section and
 * `--react-sarif`; and the same runs exit exactly as with React off, in every enforcement setting,
 * with junit.xml and the `--sarif` file unchanged.
 *
 *   node --test packages/pxsig/test/check-react.test.mjs
 *
 * Needs the engine, Chromium and the React Compiler test fixtures. A stand-in Storybook serves the
 * stories; its page plays a React renderer that commits once (`button--primary`) or keeps committing
 * (`button--small`), which is what the render-counting hook sees.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hasRust, rustBin, tempDir, testEnv, testHome } from './fixture.mjs';
import { dependsOnReact } from '../src/lib/react/peers.mjs';
import { BASE, hasCompiler, reactProject } from './react-helpers.mjs';
import { needs, src } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

const skip = needs || skipUnless(hasCompiler, 'the React Compiler test fixtures are missing');
const IDS = ['button--primary', 'button--small'];

/**
 * A stand-in Storybook for the fixture's two entries. Each page has a renderer that injects into
 * React's DevTools hook and commits a one-component tree; an id with "small" commits every 40 ms.
 */
async function reactStorybook() {
  /** @param {string} id */
  const page = (
    id
  ) => `<!doctype html><html><head><style>body{margin:0;background:#fff}#storybook-root>div{inline-size:96px;block-size:64px;background:#2a4a7a}</style></head>
<body class="sb-show-main"><div id="storybook-root"><div></div></div>
<script>window.__STORYBOOK_PREVIEW__ = { storeInitializationPromise: Promise.resolve(), currentRender: { id: ${JSON.stringify(id)}, phase: 'finished' },
  storyStoreValue: { loadStory: async () => ({ parameters: { pxsig: {} }, tags: [], playFunction: null }) } };
const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
if (hook) {
  const id = hook.inject({ bundleType: 0, version: '19.3.1' });
  const Button = function Button() {};
  let alternate = null;
  const commit = () => {
    const fiber = { tag: 0, flags: 1, type: Button, alternate, child: null, sibling: null };
    alternate = fiber;
    hook.onCommitFiberRoot(id, { current: { tag: 3, flags: 0, alternate: null, child: fiber, sibling: null } });
  };
  commit();
  if (${JSON.stringify(id.includes('small'))}) setInterval(commit, 40);
}</script></body></html>`;
  const server = createServer((req, res) => {
    res.setHeader('connection', 'close');
    const u = new URL(/** @type {string} */ (req.url), 'http://x');
    if (u.pathname === '/index.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          v: 5,
          entries: Object.fromEntries(
            IDS.map((id) => [
              id,
              {
                type: 'story',
                id,
                title: 'Button',
                name: id.split('--')[1],
                importPath: './src/Button/Button.stories.tsx',
                tags: [],
              },
            ])
          ),
        })
      );
    }
    if (u.pathname === '/iframe.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(page(u.searchParams.get('id') ?? ''));
    }
    res.writeHead(404).end();
  });
  await /** @type {Promise<void>} */ (new Promise((ok) => server.listen(0, '127.0.0.1', ok)));
  return {
    url: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`,
    close: () => server.close(),
  };
}

/**
 * The fixture project (lib/react's: `main` compiles everything, `work` makes Button bail out and
 * gives Card a finding), with `config` laid over its pxsig.config.json and Storybook at `url`.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {string} url
 * @param {Record<string, unknown>} [config]
 * @param {string} [head]
 */
const project = (t, url, config = {}, head) => {
  const dir = reactProject(t, {
    config: { storybook: { url }, ...config },
    ...(head ? { head } : {}),
  });
  return dir;
};

/**
 * Run check.mjs in `dir`.
 * @param {string} dir
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {Promise<{ code: number | null, out: string, err: string }>}
 */
const check = (dir, args, env = {}) =>
  new Promise((ok) => {
    const p = spawn(process.execPath, [join(src, 'check.mjs'), ...args], {
      cwd: dir,
      env: {
        ...testEnv(testHome),
        PXSIG_BIN: rustBin,
        PXSIG_WORKSPACE: '',
        PXSIG_URL: 'http://127.0.0.1:1',
        ...env,
      },
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => ok({ code, out, err }));
  });

/**
 * @param {string} dir
 * @param {string} name
 */
const report = (dir, name) => readFileSync(join(dir, '.pxsig', 'reports', name), 'utf8');
/** junit.xml without its timings. */
const untimed = (/** @type {string} */ xml) =>
  xml.replace(/ time="[^"]*"/g, '').replace(/ timestamp="[^"]*"/g, '');

const RUN = ['--since', 'main', '--retries', '0'];

test(
  'every alert fires: the lines, check.json, history, summary.md and --react-sarif',
  { skip },
  async (t) => {
    const sb = await reactStorybook();
    t.after(() => sb.close());
    const dir = project(t, sb.url, { react: { renders: true } });
    const r = await check(dir, [...RUN, '--react-sarif', 'react.sarif']);
    assert.equal(r.code, 1, 'two NEW entries' + r.out + r.err);
    assert.match(
      r.out,
      /\n\[check\] react: 1 files, 2 functions · 1 newly skipped by the React Compiler · 1 new findings · \d+\.\d s\n/
    );
    assert.match(r.out, /\n\[check\] {3}Button .+\n/);
    assert.match(r.out, /\n\[check\] {3}Card .+\n/);
    assert.match(
      r.out,
      /\n\[check\] renders: 2 entries · 1 still rendering at capture \(button--small\)\n/
    );
    assert.match(r.out, /\n\[check\] wrote 3 React alerts to react\.sarif \(SARIF\)\n/);

    const json = JSON.parse(report(dir, 'check.json'));
    assert.deepEqual(Object.keys(json.react), ['summary', 'alerts', 'base', 'backend']);
    assert.equal(json.react.summary.alerts, 2);
    assert.equal(json.react.summary.newBailouts, 1);
    assert.equal(json.react.base.since, 'main');
    assert.equal(json.summary.renderAlerts, 1);
    const history = report(dir, 'history.ndjson')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.deepEqual(history.at(-1).react, { alerts: 2, newBailouts: 1, renderAlerts: 1 });
    const md = report(dir, 'summary.md');
    assert.match(md, /\n### React \(alerts, not blocking\)\n- `Button` /);
    assert.match(md, /\n- `button--small`: React was still committing when pxsig captured it/);

    const sarif = JSON.parse(readFileSync(join(dir, 'react.sarif'), 'utf8'));
    const results = sarif.runs[0].results;
    assert.equal(results.length, 3);
    assert.ok(results.every((/** @type {{ level: string }} */ x) => x.level !== 'error'));
    const still = results.find(
      (/** @type {{ ruleId: string }} */ x) => x.ruleId === 'react-renders/still-rendering'
    );
    assert.equal(
      still.locations[0].physicalLocation.artifactLocation.uri,
      'src/Button/Button.stories.tsx'
    );
    const compiler = results.filter((/** @type {{ ruleId: string }} */ x) =>
      x.ruleId.startsWith('react-compiler/')
    );
    for (const c of compiler) {
      assert.equal(c.locations[0].physicalLocation.artifactLocation.uri, 'src/Button/Button.tsx');
      assert.ok(c.locations[0].physicalLocation.region.startLine > 0);
    }
    assert.deepEqual(
      compiler.map((/** @type {{ level: string }} */ c) => c.level).sort(),
      ['note', 'warning'],
      'the skipped function is a warning, the finding a note'
    );
    // Nothing absolute in what the run wrote.
    for (const text of [r.out, r.err, report(dir, 'check.json'), md, JSON.stringify(sarif)])
      assert.ok(!text.includes(dir), 'no absolute path');
  }
);

test(
  'alerts never change the exit code, junit.xml or the --sarif file, in any enforcement setting',
  { skip },
  async (t) => {
    const sb = await reactStorybook();
    t.after(() => sb.close());
    const warn = { gates: { visual: 'warn' }, advisoryExit: 0, warnUntil: '2099-12-31' };
    /** @type {[string, Record<string, unknown>, string[], Record<string, string>, number][]} */
    const settings = [
      ['warn mode', warn, [], {}, 0],
      ['--enforce', warn, ['--enforce'], {}, 1],
      ['PXSIG_ENFORCEMENT=enforce', warn, [], { PXSIG_ENFORCEMENT: 'enforce' }, 1],
      ['an expired warnUntil', { ...warn, warnUntil: '2000-01-01' }, [], {}, 1],
    ];
    for (const [name, enforcement, args, env, exit] of settings) {
      /** @type {Record<string, { code: number | null, junit: string, sarif: string }>} */
      const runs = {};
      for (const react of ['off', 'on']) {
        const dir = project(t, sb.url, { enforcement, react: { renders: true } });
        const r = await check(dir, [...RUN, ...args, '--sarif', 'a11y.sarif'], {
          ...env,
          ...(react === 'off' ? { PXSIG_REACT: 'off' } : {}),
        });
        if (react === 'on') assert.match(r.out, /\[check\] react: .+ newly skipped/, name);
        else assert.doesNotMatch(r.out, /\[check\] (react|renders):/, name);
        runs[react] = {
          code: r.code,
          junit: untimed(report(dir, 'junit.xml')),
          sarif: readFileSync(join(dir, 'a11y.sarif'), 'utf8'),
        };
      }
      assert.equal(runs.on.code, exit, `${name}: exit`);
      assert.equal(runs.on.code, runs.off.code, `${name}: the same exit with React on and off`);
      assert.equal(runs.on.junit, runs.off.junit, `${name}: junit.xml`);
      assert.equal(runs.on.sarif, runs.off.sarif, `${name}: the --sarif file`);
    }
  }
);

test(
  'no alert: summary.md has no React section; --no-react, the compiler absent and no ref',
  { skip },
  async (t) => {
    const sb = await reactStorybook();
    t.after(() => sb.close());
    // Nothing changed in Button.tsx: analysed, no alert, nothing in summary.md.
    const quiet = project(t, sb.url, {}, BASE);
    const q = await check(quiet, RUN);
    assert.match(
      q.out,
      /\n\[check\] react: 0 files, 0 functions · 0 newly skipped by the React Compiler · \d+\.\d s\n/
    );
    assert.doesNotMatch(report(quiet, 'summary.md'), /React/);
    assert.deepEqual(Object.keys(JSON.parse(report(quiet, 'check.json')).react), [
      'summary',
      'alerts',
      'base',
      'backend',
    ]);
    // --no-react: nothing analysed, nothing said; check.json says why.
    const off = project(t, sb.url);
    const o = await check(off, [...RUN, '--no-react']);
    assert.doesNotMatch(o.out, /\[check\] (react|renders):/);
    assert.deepEqual(JSON.parse(report(off, 'check.json')).react, { skipped: 'off' });
    // No --since / --changed: no analysis and no `react` key.
    const full = project(t, sb.url);
    const f = await check(full, ['--retries', '0']);
    assert.doesNotMatch(f.out, /\[check\] react:/);
    assert.equal(JSON.parse(report(full, 'check.json')).react, undefined);
    const history = report(full, 'history.ndjson')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.equal(history.at(-1).react, undefined, 'no counts: the line as before');
    // The compiler absent in a project without React: nothing said; check.json says why.
    const plain = reactProject(t, { babel: null, config: { storybook: { url: sb.url } } });
    const p = await check(plain, RUN);
    assert.doesNotMatch(p.out, /\[check\] react:/);
    assert.deepEqual(JSON.parse(report(plain, 'check.json')).react, { skipped: 'not-installed' });
    // ... and in a project that depends on React: one line.
    const bare = reactProject(t, { babel: null, config: { storybook: { url: sb.url } } });
    writeFileSync(
      join(bare, 'package.json'),
      JSON.stringify({ name: 'ui', devDependencies: { react: '^19.0.0' } })
    );
    const b = await check(bare, RUN);
    assert.match(
      b.out,
      /\n\[check\] react: babel-plugin-react-compiler and @babel\/core are not installed in this project: compiler analysis skipped \(react\.compiler: false hides this line\)\n/
    );
    assert.deepEqual(JSON.parse(report(bare, 'check.json')).react, { skipped: 'not-installed' });
  }
);

test("a project depends on React when its package.json or the workspace root's names it", (t) => {
  const ws = tempDir('react-deps', t);
  const app = join(ws, 'apps', 'ui');
  mkdirSync(app, { recursive: true });
  const P = { root: app, workspaceRoot: ws };
  assert.equal(dependsOnReact(P), false, 'no package.json');
  writeFileSync(join(app, 'package.json'), '{ not json');
  assert.equal(dependsOnReact(P), false, 'unreadable');
  writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { vue: '^3' } }));
  assert.equal(dependsOnReact(P), false, 'another framework');
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) {
    writeFileSync(join(app, 'package.json'), JSON.stringify({ [k]: { react: '^19' } }));
    assert.equal(dependsOnReact(P), true, k);
  }
  writeFileSync(join(app, 'package.json'), '{}');
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ devDependencies: { react: '^19' } }));
  assert.equal(dependsOnReact(P), true, "the workspace root's");
});

test(
  'pxsig react --sarif: the compiler alerts, and an empty file when nothing was analysed',
  {
    skip: skipUnless(
      hasRust && hasCompiler,
      'the engine or the React Compiler fixtures are missing'
    ),
  },
  (t) => {
    const cli = fileURLToPath(new URL('../bin/pxsig.mjs', import.meta.url));
    /**
     * @param {string} dir
     * @param {string[]} args
     */
    const run = (dir, args) =>
      spawnSync(process.execPath, [cli, 'react', ...args], {
        cwd: dir,
        encoding: 'utf8',
        env: testEnv(testHome, {
          PXSIG_FORMAT: 'plain',
          PXSIG_NO_DELEGATE: '1',
          PXSIG_BIN: rustBin,
        }),
      });
    const dir = reactProject(t);
    const r = run(dir, ['--sarif', 'r.sarif']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /wrote 2 React alerts to r\.sarif \(SARIF\)/);
    const log = JSON.parse(readFileSync(join(dir, 'r.sarif'), 'utf8'));
    assert.deepEqual(
      log.runs[0].results.map((/** @type {{ ruleId: string }} */ x) => x.ruleId).sort(),
      ['react-compiler/refs', 'react-compiler/set-state-in-effect']
    );
    const rule = log.runs[0].tool.driver.rules.find(
      (/** @type {{ id: string }} */ x) => x.id === 'react-compiler/refs'
    );
    assert.equal(rule.helpUri, 'https://react.dev/reference/eslint-plugin-react-hooks/lints/refs');
    const off = run(dir, ['--sarif', 'off.sarif', '--no-react']);
    assert.equal(off.status, 0, off.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'off.sarif'), 'utf8')).runs[0].results, []);
    assert.equal(run(dir, ['--sarif']).status, 2, 'a value is needed');
  }
);
