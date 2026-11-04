/**
 * react-config.test.mjs — the `react` config key (lib/react/config.mjs): defaults, spellings, the
 * off switches and their sources, and that a bad value turns the analysis off instead of failing;
 * the CLI's summary line (cli/react.mjs).
 *
 *   node --test packages/pxsig/test/react-config.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_EXCLUDE, configWarning, reactConfig } from '../src/lib/react/config.mjs';
import { autoTarget } from '../src/lib/react/peers.mjs';
import { summaryLine } from '../src/cli/react.mjs';

/** @import { Project } from '../src/types.js' */
/** @import { ReactReport } from '../src/types/react.js' */

/**
 * @param {unknown} react
 * @param {Record<string, string>} [sources]
 */
const P = (react, sources = {}) =>
  /** @type {Pick<Project, 'config' | 'configSources'>} */ (
    /** @type {unknown} */ ({
      config: react === undefined ? {} : { react },
      configSources: sources,
    })
  );

test('defaults: compiler on (auto), lint on, renders off', () => {
  for (const raw of [undefined, true, {}]) {
    const c = reactConfig(P(raw), { env: {} });
    assert.deepEqual(c, {
      off: null,
      problems: [],
      compiler: true,
      lint: true,
      compilationMode: 'infer',
      target: 'auto',
      environment: {},
      exclude: [...DEFAULT_EXCLUDE],
      renders: false,
    });
  }
});

test('react.compiler: false canonical, "off" accepted, true and "auto" on', () => {
  for (const v of [false, 'off'])
    assert.equal(reactConfig(P({ compiler: v }), { env: {} }).compiler, false);
  for (const v of [true, 'auto'])
    assert.equal(reactConfig(P({ compiler: v }), { env: {} }).compiler, true);
  // The compiler off leaves the rest on.
  assert.equal(reactConfig(P({ compiler: false, renders: true }), { env: {} }).renders, true);
});

test('off switches name where they came from', () => {
  assert.equal(reactConfig(P(false), { env: {} }).off, 'react: false in pxsig.config.json');
  assert.equal(
    reactConfig(P(false, { react: 'workspace defaults' }), { env: {} }).off,
    'react: false in pxsig.workspace.json'
  );
  assert.equal(reactConfig(P({}), { flags: { 'no-react': true }, env: {} }).off, '--no-react');
  assert.equal(reactConfig(P({}), { env: { PXSIG_REACT: 'OFF' } }).off, 'PXSIG_REACT=off');
  assert.equal(reactConfig(P({}), { env: { PXSIG_REACT: 'on' } }).off, null);
});

test('a bad value: a warning line and the feature off, never a throw', () => {
  for (const [raw, line] of /** @type {[unknown, string][]} */ ([
    ['yes', 'react must be an object, true or false'],
    [{ compiler: 'maybe' }, 'react.compiler must be true, false, "auto" or "off"'],
    [{ lint: 'yes' }, 'react.lint must be true or false'],
    [
      { compilationMode: 'some' },
      'react.compilationMode must be "infer", "annotation", "syntax", "all"',
    ],
    [{ target: '20' }, 'react.target must be "17", "18", "19" or "auto"'],
    [{ environment: [] }, 'react.environment must be an object'],
    [{ exclude: ['', 'x'] }, 'react.exclude must be an array of globs'],
    [
      { backend: 'oxc' },
      'react.backend is not a React setting (compiler, lint, compilationMode, target, environment, exclude, renders)',
    ],
  ])) {
    const c = reactConfig(P(raw), { env: {} });
    assert.equal(c.compiler, false, JSON.stringify(raw));
    assert.equal(c.problems[0], line);
    assert.equal(configWarning(c), `[pxsig] ${line}: React analysis is off for this run`);
  }
  assert.equal(reactConfig(P({ target: 18 }), { env: {} }).target, '18');
});

test('target auto: the project React major, else 19', () => {
  assert.deepEqual(['17.0.2', '18.3.1', '19.3.1', '20.0.0', null].map(autoTarget), [
    '17',
    '18',
    '19',
    '19',
    '19',
  ]);
});

test('the summary line: a comparison, and the inventory', () => {
  const summary = {
    files: 4,
    functions: 9,
    compiled: 7,
    bailouts: 2,
    newBailouts: 1,
    findings: 0,
    newFindings: 0,
    fixed: 1,
    optedOut: 0,
    alerts: 1,
    ms: 310,
    cached: 2,
  };
  const r = /** @type {ReactReport} */ (
    /** @type {unknown} */ ({ base: { since: 'main', commit: 'abc1234' }, summary })
  );
  assert.equal(
    summaryLine(r, 2),
    'react: 4 files, 9 functions · 1 newly skipped by the React Compiler · 1 fixed · 0.3 s (2 cached)'
  );
  const inv = /** @type {ReactReport} */ (
    /** @type {unknown} */ ({ base: null, summary: { ...summary, optedOut: 1 } })
  );
  assert.equal(
    summaryLine(inv, 0),
    'react: 4 files, 9 functions · 7 compiled · 2 skipped by the React Compiler · 1 opted out · 0.3 s'
  );
});
