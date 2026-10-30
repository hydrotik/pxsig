// `pxsig doctor` and `pxsig_doctor` before a manifest exists: the setup preflight, the error once,
// exit 2, and no program started but the engine's `--version`. Temp folders only; no Storybook, no
// server.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { cli, src, tree } from './features-helpers.mjs';
import { rustBin, testEnv, testHome } from './fixture.mjs';

/** A project `pxsig init` could have written: a config, a story, no manifest. */
const fresh = () =>
  tree({
    'pxsig.config.json': {
      name: 'fresh',
      storybook: { url: 'http://127.0.0.1:1', staticDir: 'storybook-static' },
    },
    'src/A/A.stories.tsx': "export default { title: 'C/A' };\nexport const One = {};\n",
  });

/**
 * The `[spawn]` lines PXSIG_DEBUG=spawn printed: each must be the engine's `--version`.
 * @param {string} stderr
 */
const starts = (stderr) => stderr.split('\n').filter((l) => l.startsWith('[spawn] '));

test('doctor without a manifest prints the preflight once, then the next step, exit 2', () => {
  const root = fresh();
  const r = cli(['doctor', '--offline', '--plain'], root, {
    PXSIG_DEBUG: 'spawn',
    PXSIG_AGENT: 'probe',
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const all = r.stdout + r.stderr;
  assert.equal(all.split('no readable manifest at').length - 1, 1, all);
  for (const row of ['Engine', 'Playwright', 'Chromium', 'Storybook URL', 'Static build'])
    assert.match(r.stdout, new RegExp(`${row}`), row);
  assert.match(r.stdout, /http:\/\/127\.0\.0\.1:1 \(config; not requested\)/);
  assert.match(r.stdout, /storybook-static \(missing\)/);
  assert.match(r.stdout, /probe \(PXSIG_AGENT=probe\)/);
  assert.match(r.stdout, /pxsig manifest/);
  // At most the engine's `--version` (what `pxsig --version` runs); nothing else starts.
  assert.ok(starts(r.stderr).length <= 1, r.stderr);
  for (const line of starts(r.stderr))
    assert.match(line, /^\[spawn\] .*pxsig(\.exe)? --version$/, line);
});

test('doctor --json without a manifest carries the same fields', () => {
  const root = fresh();
  const r = cli(['doctor', '--offline', '--json'], root, { PXSIG_DEBUG: 'spawn' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.match(out.error, /^no readable manifest at /);
  assert.equal(out.next, 'pxsig manifest');
  const pf = out.preflight;
  assert.deepEqual(Object.keys(pf).sort(), [
    'agent',
    'chromium',
    'engine',
    'playwright',
    'storybook',
  ]);
  assert.equal(pf.engine.path.split('/').pop(), rustBin.split(/[\\/]/).pop());
  assert.equal(typeof pf.engine.present, 'boolean');
  if (pf.engine.present) assert.match(String(pf.engine.version), /^\d+\.\d+\.\d+/);
  assert.equal(typeof pf.chromium.present, 'boolean');
  if (pf.playwright.path) assert.match(String(pf.playwright.version), /^\d+\.\d+\.\d+/);
  assert.deepEqual(pf.storybook, {
    url: 'http://127.0.0.1:1',
    staticDir: 'storybook-static',
    staticDirPresent: false,
  });
  assert.ok(pf.agent === null || typeof pf.agent.name === 'string');
  assert.ok(!r.stderr.includes('no readable manifest'), r.stderr);
  for (const line of starts(r.stderr))
    assert.match(line, /^\[spawn\] .*pxsig(\.exe)? --version$/, line);
});

test('pxsig_doctor without a manifest answers the error and the same preflight', () => {
  const root = fresh();
  const call = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'pxsig_doctor', arguments: { offline: true } },
  };
  const m = spawnSync(process.execPath, [join(src, 'mcp.mjs')], {
    cwd: root,
    encoding: 'utf8',
    input: `${JSON.stringify(call)}\n`,
    timeout: 30_000,
    env: testEnv(testHome, {
      PXSIG_URL: 'http://127.0.0.1:1',
      PXSIG_BIN: rustBin,
      PXSIG_WORKSPACE: '',
      PXSIG_PROJECT: '',
      PXSIG_DEBUG: 'spawn',
    }),
  });
  const reply = JSON.parse(m.stdout.split('\n').filter(Boolean)[0]);
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /^Error: no readable manifest at /);
  const detail = JSON.parse(reply.result.content[1].text);
  assert.equal(detail.next, 'pxsig manifest');
  assert.equal(detail.preflight.storybook.url, 'http://127.0.0.1:1');
  for (const line of starts(m.stderr))
    assert.match(line, /^\[spawn\] .*pxsig(\.exe)? --version$/, line);
});
