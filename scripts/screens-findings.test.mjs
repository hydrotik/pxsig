// screens-project.mjs and screens-findings.mjs: which store a screens run checks, and its findings by kind.
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ariaVsReference, runFindings, writeFindings } from './lib/screens-findings.mjs';
import { projectHints, projectOfArgs, screensProject } from './lib/screens-project.mjs';
import { wantsLive } from './screens-container.mjs';

const repo = '/r';

test('the reference project is unchanged: packages/dashboard, its locks in fixtures/, live screens', () => {
  const p = screensProject(repo);
  assert.equal(p.dir, '/r/packages/dashboard');
  assert.equal(p.build, '/r/packages/pxsig/dist/dashboard');
  assert.equal(p.locks, '/r/packages/dashboard/fixtures/locked');
  assert.equal(p.geometry, '/r/packages/dashboard/fixtures/locked/geometry.json');
  assert.equal(p.unstable, '/r/packages/dashboard/fixtures/unstable.json');
  assert.equal(p.fixturesOnly, false);
  assert.equal(p.fidelity, false);
  assert.equal(p.ariaReference, null);
  const h = projectHints(p, repo);
  assert.equal(
    h.review,
    '[screens] review them: cd packages/dashboard && node ../pxsig/bin/pxsig.mjs serve (approve with serve --link)'
  );
  assert.equal(
    h.locks,
    '[screens] a structure or geometry change made on purpose: pnpm screens:check --update-locks, and commit packages/dashboard/fixtures/locked'
  );
});

test('plain: its own store and locks outside fixtures/, fixture screens only', () => {
  const p = projectOfArgs(repo, ['--project', 'plain', '--no-live']);
  assert.equal(p.dir, '/r/packages/dashboard/plain');
  assert.equal(p.build, '/r/target/dashboard-plain');
  assert.equal(p.locks, '/r/packages/dashboard/plain/locked');
  assert.equal(p.geometry, '/r/packages/dashboard/plain/locked/geometry.json');
  assert.equal(p.unstable, '/r/packages/dashboard/plain/locked/unstable.json');
  assert.equal(p.fixturesOnly, true);
  assert.equal(p.fidelity, true);
  assert.equal(p.ariaReference, '/r/packages/dashboard/fixtures/locked');
  const h = projectHints(p, repo);
  assert.match(
    h.review,
    /cd packages\/dashboard\/plain && node \.\.\/\.\.\/pxsig\/bin\/pxsig\.mjs serve/
  );
  assert.match(
    h.locks,
    /screens:check --project plain --update-locks, and commit packages\/dashboard\/plain\/locked$/
  );
  assert.throws(() => projectOfArgs(repo, ['--project', 'other']), /no such screens project/);
  assert.equal(projectOfArgs(repo, ['--fixtures-only']).fixturesOnly, true);
});

test('a fixtures-only project stages no live screens', () => {
  assert.equal(wantsLive([]), true);
  assert.equal(wantsLive(['--project', 'plain']), false);
  assert.equal(wantsLive(['--fixtures-only']), false);
  assert.equal(wantsLive(['--no-live']), false);
});

test('findings by kind: a missing lock is apart from a changed one, entries apart from findings', () => {
  const screens = [
    {
      id: 'a',
      rendered: true,
      axe: [{ id: 'color-contrast', count: 2 }],
      layout: [],
      fidelity: [],
    },
    {
      id: 'b',
      rendered: true,
      axe: [],
      layout: [{ rule: 'overflow', text: 'x' }],
      alignment: [{ rule: 'dot', text: 'y' }],
      fidelity: [{ rule: 'R1', text: 'z' }],
    },
    { id: 'c', rendered: false, axe: [{ id: 'never', count: 1 }], layout: [] },
  ];
  const f = runFindings({
    screens,
    idOf: (s) => s.id,
    topBar: { findings: [{ rule: 'top-bar', text: 'wraps at 640' }] },
    unstable: ['unstable a@dark: pixels'],
    structure: [
      'inspector/header-1.aria.yml: no locked structure',
      'x/y-1.aria.yml: the structure changed (line 1)',
    ],
    geometry: ['shell.top-bar #1: anchor bar is not locked'],
  });
  assert.deepEqual(
    f.map((x) => x.kind),
    [
      'axe',
      'layout',
      'alignment',
      'fidelity',
      'top-bar',
      'unstable',
      'structure (not locked yet)',
      'structure',
      'geometry (not locked yet)',
    ]
  );
  const dir = mkdtempSync(join(tmpdir(), 'screens-findings-'));
  writeFindings({
    reports: dir,
    project: 'pxsig-plain',
    findings: f,
    gated: ['axe', 'layout'],
    rows: [
      { id: 'n', pass: false, new: true },
      { id: 'c', pass: false, new: false },
      { id: 'e', pass: false, error: 'not rendered' },
      { id: 's', pass: true, skipped: true },
    ],
  });
  const md = readFileSync(join(dir, 'findings.md'), 'utf8');
  assert.match(md, /### axe: 1\n/);
  assert.match(md, /### fidelity: 1 \(advisory here\)/);
  assert.match(md, /- changed: 1\n- new: no baseline: 1\n- not rendered: 1\n/);
  const json = JSON.parse(readFileSync(join(dir, 'findings.json'), 'utf8'));
  assert.deepEqual(json.entries, { changed: ['c'], new: ['n'], error: ['e: not rendered'] });
});

test('structure against the reference: advisory, the first line that differs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'screens-aria-'));
  const put = (/** @type {string} */ f, /** @type {string} */ t) => {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), t);
  };
  put('now/a/x-1.aria.yml', '- main\n');
  put('now/a/x-2.aria.yml', '- main\n- button\n');
  put('now/a/x-3.aria.yml', '- nav\n');
  put('ref/a/x-1.aria.yml', '- main\n');
  put('ref/a/x-2.aria.yml', '- main\n- link\n');
  const line = ariaVsReference({
    current: join(dir, 'now'),
    reference: join(dir, 'ref'),
    reports: join(dir, 'reports'),
    project: 'pxsig-plain',
  });
  assert.match(line, /1 the same, 1 differ/);
  const md = readFileSync(join(dir, 'reports', 'aria-vs-reference.md'), 'utf8');
  assert.match(md, /a\/x-2\.aria\.yml: line 2: - - link \/ \+ - button/);
  assert.match(md, /a\/x-3\.aria\.yml: no reference lock/);
});
