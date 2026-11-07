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
      choice: 'auto',
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
  // "babel" and "oxc" name the compiler; true and "auto" are the same choice (Babel, today).
  for (const [v, choice] of [
    [true, 'auto'],
    ['auto', 'auto'],
    ['babel', 'babel'],
    ['oxc', 'oxc'],
  ]) {
    const c = reactConfig(P({ compiler: v }), { env: {} });
    assert.deepEqual([c.compiler, c.choice], [true, choice], String(v));
  }
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
  // --no-react through the flags layer (`react: false` there).
  assert.equal(reactConfig(P(false, { react: 'flags' }), { env: {} }).off, '--no-react');
  assert.equal(reactConfig(P({}), { env: { PXSIG_REACT: 'false' } }).off, 'PXSIG_REACT=off');
  assert.equal(reactConfig(P({}), { env: { PXSIG_REACT: 'OFF' } }).off, 'PXSIG_REACT=off');
  assert.equal(reactConfig(P({}), { env: { PXSIG_REACT: 'on' } }).off, null);
});

test('a bad value: a warning line and its part off, never a throw', () => {
  for (const [raw, line] of /** @type {[unknown, string][]} */ ([
    [{ compiler: 'maybe' }, 'react.compiler must be true, false, "auto", "off", "babel" or "oxc"'],
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
    // A compiler-side key: the compiler analysis off; render counting keeps its own setting.
    const c = reactConfig(P({ .../** @type {object} */ (raw), renders: true }), { env: {} });
    assert.equal(c.compiler, false, JSON.stringify(raw));
    assert.equal(c.renders, true, JSON.stringify(raw));
    assert.equal(c.off, null);
    assert.equal(c.problems[0], `${line}: compiler analysis is off for this run`);
    assert.equal(configWarning(c), `[pxsig] ${line}: compiler analysis is off for this run`);
  }
  // A bad `renders`: render counting off, the compiler analysis on, no compiler warning.
  const r = reactConfig(P({ renders: 'yes' }), { env: {} });
  assert.deepEqual([r.compiler, r.renders, r.off], [true, false, null]);
  assert.deepEqual(r.problems, [
    'react.renders must be true or false: render counting is off for this run',
  ]);
  assert.equal(configWarning(r), null);
  // A `react` that is neither false nor an object: everything off.
  const all = reactConfig(P('yes'), { env: {} });
  assert.deepEqual([all.compiler, all.renders, all.off], [false, false, 'a bad react value']);
  assert.equal(
    configWarning(all),
    '[pxsig] react must be false or an object: React features are off for this run'
  );
  // "off" is react: false; numbers are accepted for the target.
  assert.equal(reactConfig(P('off'), { env: {} }).off, 'react: false in pxsig.config.json');
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
