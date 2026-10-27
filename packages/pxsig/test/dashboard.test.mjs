// `pxsig dashboard gaps | build`: adapter resolution and the conformance report. No build runs here
// (it needs Vite and a design system); scripts/examples-test.mjs builds the plain example.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/pxsig.mjs', import.meta.url));
const pxsig = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PXSIG_FORMAT: 'plain', PXSIG_UI_ADAPTER: '' } });

test('gaps: the reference adapter covers every contract component', () => {
  const r = pxsig(['dashboard', 'gaps', '--ui', 'hydrotik', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const g = JSON.parse(r.stdout);
  assert.deepEqual(g.problems, []);
  assert.ok(g.rows.length >= 40);
  assert.deepEqual(g.rows.filter((x) => !['full', 'bespoke'].includes(x.status)), []);
  assert.ok(g.rows.every((x) => x.usedBy.length), 'every contract component is used somewhere');
});

test('an unknown adapter name or path fails at once, naming what it looked for', () => {
  let r = pxsig(['dashboard', 'gaps', '--ui', 'nope']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown UI adapter "nope".*Built-in adapters: hydrotik/);
  r = pxsig(['dashboard', 'build', '--ui', './no/such/adapter']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no UI adapter at "\.\/no\/such\/adapter"/);
});

test('gaps: dashboard.ui in pxsig.config.json; a missing required component is a problem', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-ui-'));
  try {
    mkdirSync(join(dir, 'ui'));
    writeFileSync(join(dir, 'pxsig.config.json'), JSON.stringify({ dashboard: { ui: './ui' } }));
    writeFileSync(join(dir, 'ui', 'index.tsx'), "export const name = 'tiny';\nexport const tokens = {};\nexport function Button() { return null; }\nexport const Kbd = () => null;\n");
    writeFileSync(join(dir, 'ui', 'conformance.json'), JSON.stringify({ adapter: 'tiny', components: { Button: { status: 'partial', note: 'no href' }, Chart: { status: 'full' } } }));
    const r = pxsig(['dashboard', 'gaps', '--json'], dir);
    assert.equal(r.status, 1);
    const g = JSON.parse(r.stdout);
    const by = Object.fromEntries(g.rows.map((x) => [x.name, x]));
    assert.equal(by.Button.status, 'partial');
    assert.equal(by.Kbd.status, 'full', 'exported and undeclared counts as full');
    assert.equal(by.Chart.status, 'missing', 'declared but not exported');
    assert.match(by.DataTable.note, /fallback/);
    assert.ok(g.problems.some((p) => /Select is required and missing/.test(p)));
    const text = pxsig(['dashboard', 'gaps'], dir).stdout;
    assert.match(text, /UI adapter "tiny"/);
    assert.match(text, /\n {2}TopNav \(required\) · the build fails without it/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gaps and build compare the adapter's contract version with this pxsig's", () => {
  const r = pxsig(['dashboard', 'gaps', '--ui', 'hydrotik', '--json']);
  assert.equal(JSON.parse(r.stdout).contract.status, 'same');
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-ui-'));
  try {
    mkdirSync(join(dir, 'ui'));
    writeFileSync(join(dir, 'ui', 'index.tsx'), "export const name = 'old';\nexport const tokens = {};\n");
    const conformance = (contract) => writeFileSync(join(dir, 'ui', 'conformance.json'), JSON.stringify({ adapter: 'old', contract, components: {} }));
    conformance('0.1.0');
    const old = JSON.parse(pxsig(['dashboard', 'gaps', '--ui', './ui', '--json'], dir).stdout);
    assert.equal(old.contract.status, 'older-major');
    assert.ok(old.problems.some((p) => /^contract: written for contract 0\.1\.0; this pxsig has 1\.1\.0, a major change/.test(p)), old.problems.join('\n'));
    const b = pxsig(['dashboard', 'build', '--ui', './ui'], dir);
    assert.equal(b.status, 2);
    assert.match(b.stderr, /the "ui" adapter is written for contract 0\.1\.0[\s\S]*1\.0\.0:/, 'refused before any build tool is needed, with the migration notes');
    conformance('9.0.0');
    const newer = JSON.parse(pxsig(['dashboard', 'gaps', '--ui', './ui', '--json'], dir).stdout);
    assert.equal(newer.contract.status, 'newer');
    assert.ok(!newer.problems.some((p) => p.startsWith('contract:')), 'a newer adapter is a note, not a problem');
    assert.match(pxsig(['dashboard', 'gaps', '--ui', './ui'], dir).stdout, /\ncontract: written for contract 9\.0\.0; this pxsig has 1\.1\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
