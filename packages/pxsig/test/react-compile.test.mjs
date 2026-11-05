/**
 * react-compile.test.mjs — the worker's half of React analysis (lib/react/worker.mjs, pool.mjs)
 * on real compiles: babel-plugin-react-compiler 1.0.0 under @babel/core 7.29 and 8.1 (the test
 * fixture packages in test/react-compiler/), every outcome, the names, the two passes, the parser
 * plugins; and the pool's timeout and a worker that dies.
 *
 *   node --test packages/pxsig/test/react-compile.test.mjs
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { compile, functions, load, records } from '../src/lib/react/worker.mjs';
import { createPool } from '../src/lib/react/pool.mjs';
import { findPeer } from '../src/lib/react/peers.mjs';
import { tempDir } from './fixture.mjs';
import { fixtureModules, hasCompiler } from './react-helpers.mjs';
import { skipUnless } from './strict.mjs';

/** @import { ReactFunction } from '../src/types/react.js' */

const skip = skipUnless(
  hasCompiler,
  'the React Compiler test fixtures are not installed (pnpm install)'
);

/** @param {7 | 8} major */
function paths(major) {
  const root = join(fixtureModules(major), '..');
  const at = { root, workspaceRoot: root };
  const babel = findPeer(at, '@babel/core');
  const compiler = findPeer(at, 'babel-plugin-react-compiler');
  assert.ok(babel && compiler, `babel${major} fixture`);
  return { babel: babel.path, compiler: compiler.path, version: babel.version };
}

const SOURCE = `import { forwardRef, memo, useEffect, useRef, useState } from 'react';
export function Good({ a }) { return <div>{a}</div>; }
export function RefBad() { const r = useRef(0); return <div>{r.current}</div>; }
export const Arrow = () => { const r = useRef(0); r.current = 2; return <i />; };
export function useDerived(x) { const [s, setS] = useState(0); useEffect(() => { setS(x); }, [x]); return s; }
export function Opt() { 'use no memo'; return <b />; }
export function Sup() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [a] = useState(0); return <p>{a}</p>;
}
export function Tri() { try { return <a />; } catch (e) { return null; } }
export const Fancy = memo(forwardRef(function (props, ref) { const r = useRef(0); return <i>{r.current}</i>; }));
export function Effect() { const [v, setV] = useState(0); useEffect(() => { setV(1); }, []); return <i>{v}</i>; }
`;

/**
 * @param {ReactFunction[]} fns
 * @param {string} name
 */
const fn = (fns, name) => {
  const f = fns.find((x) => x.name === name);
  assert.ok(f, `${name} in ${JSON.stringify(fns.map((x) => x.name))}`);
  return f;
};
/** @param {ReactFunction} f */
const rules = (f) => f.diagnostics.map((d) => `${d.rule}:${d.stops ? 'stops' : 'finding'}`);

for (const major of /** @type {const} */ ([7, 8]))
  test(`every outcome, named, under Babel ${major}`, { skip }, async () => {
    const p = paths(major);
    assert.match(p.version, new RegExp(`^${major}\\.`));
    const env = { ...(await load(p)), cwd: tempDir('cwd') };
    const options = { compilationMode: 'infer', target: '19', environment: {}, lint: true };
    const r = compile(
      { ...env, options },
      { path: 'src/x.tsx', text: SOURCE, parser: ['jsx', 'typescript'] }
    );
    assert.ok('functions' in r, JSON.stringify(r));
    const fns = r.functions;
    assert.equal(fn(fns, 'Good').outcome, 'compiled');
    assert.equal(fn(fns, 'Good').memoSlots, 2);
    assert.deepEqual(rules(fn(fns, 'Good')), []);
    assert.deepEqual(
      [fn(fns, 'RefBad').outcome, ...rules(fn(fns, 'RefBad'))],
      ['bailout', 'refs:stops']
    );
    assert.equal(fn(fns, 'RefBad').diagnostics[0].reason, 'Cannot access refs during render');
    assert.equal(fn(fns, 'RefBad').diagnostics[0].line, 3);
    // Named from its variable (the compiler gives an arrow no name), through memo(forwardRef(…)).
    assert.equal(fn(fns, 'Arrow').outcome, 'bailout');
    assert.equal(fn(fns, 'Fancy').outcome, 'bailout');
    // A hook; a validation the build pass does not run is a finding, the hook still compiles.
    assert.equal(fn(fns, 'useDerived').kind, 'hook');
    assert.deepEqual(
      [fn(fns, 'useDerived').outcome, ...rules(fn(fns, 'useDerived'))],
      ['compiled', 'no-deriving-state-in-effects:finding']
    );
    assert.deepEqual([fn(fns, 'Opt').outcome, ...rules(fn(fns, 'Opt'))], ['opted-out']);
    assert.deepEqual(
      [fn(fns, 'Sup').outcome, ...rules(fn(fns, 'Sup'))],
      ['bailout', 'rule-suppression:stops']
    );
    // A diagnostic with no function location belongs to the component, not the effect's callback.
    assert.deepEqual(rules(fn(fns, 'Tri')), ['error-boundaries:finding']);
    assert.deepEqual(rules(fn(fns, 'Effect')), ['set-state-in-effect:finding']);
    assert.equal(fns.filter((f) => f.kind === 'component').length, fns.length - 1);

    // Without lint: the same outcomes, no findings.
    const plain = compile(
      { ...env, options: { ...options, lint: false } },
      { path: 'src/x.tsx', text: SOURCE, parser: ['jsx', 'typescript'] }
    );
    assert.ok('functions' in plain);
    for (const f of plain.functions)
      assert.ok(
        f.diagnostics.every((d) => d.stops),
        f.name
      );
    assert.deepEqual(
      plain.functions.map((f) => [f.name, f.outcome]),
      fns.map((f) => [f.name, f.outcome])
    );
  });

test(
  'parser plugins by extension; a file that does not parse is a compiler error with no path',
  { skip },
  async () => {
    const cwd = tempDir('cwd');
    const env = {
      ...(await load(paths(7))),
      cwd,
      options: { compilationMode: 'infer', target: '19', environment: {}, lint: false },
    };
    const js = compile(env, {
      path: 'src/a.jsx',
      text: 'export function A() { return <a />; }\n',
      parser: ['jsx'],
    });
    assert.deepEqual('functions' in js && js.functions.map((f) => f.outcome), ['compiled']);
    const ts = compile(env, {
      path: 'src/use-x.ts',
      text: 'export function useX(n: number): number { return n * 2; }\n',
      parser: ['typescript'],
    });
    assert.ok('functions' in ts, JSON.stringify(ts));
    // TypeScript without the typescript plugin does not parse.
    const bad = compile(env, {
      path: 'src/b.js',
      text: 'export function B(p: number) { return <b />; }\n',
      parser: ['jsx'],
    });
    assert.deepEqual(bad, { error: 'compiler-error' });
    assert.ok(!JSON.stringify(bad).includes(cwd));
  }
);

test('records: an unknown event is a compiler error naming the kind; duplicates merge', () => {
  const loc = { start: { line: 1, column: 7 }, end: { line: 3, column: 1 } };
  const spans = [{ line: 1, column: 7, endLine: 3, endColumn: 1, name: 'A' }];
  const detail = {
    options: {
      category: 'Refs',
      reason: 'Cannot access refs during render',
      details: [{ loc: { start: { line: 2, column: 3 }, end: { line: 2, column: 9 } } }],
    },
  };
  const recs = records(
    [
      { kind: 'CompileError', fnLoc: loc, detail },
      { kind: 'CompileError', fnLoc: loc, detail },
      {
        kind: 'SomethingNew',
        fnLoc: { start: { line: 5, column: 0 }, end: { line: 6, column: 0 } },
      },
      { kind: 'Timing' },
    ],
    spans,
    new Map([['Refs', 'refs']])
  );
  const fns = functions(recs, null);
  assert.deepEqual(
    fns.map((f) => [f.name, f.outcome, f.diagnostics.length]),
    [
      ['A', 'bailout', 1],
      ['anonymous-1', 'compiler-error', 1],
    ]
  );
  assert.match(fns[1].diagnostics[0].reason, /unknown event: SomethingNew/);
});

test(
  'pool: a slow file times out, a dying worker fails its task, the run goes on',
  { skip },
  async () => {
    const p = paths(7);
    const options = { compilationMode: 'infer', target: '19', environment: {}, lint: false };
    const slow = createPool({ size: 1, ...p, cwd: tempDir('cwd'), options, timeoutMs: 1 });
    assert.deepEqual(
      await slow.compile({ path: 'a.tsx', text: SOURCE, parser: ['jsx', 'typescript'] }),
      { error: 'analysis-timeout' }
    );
    await slow.close();
    // A "Babel" whose transform ends the worker thread.
    const dir = tempDir('dying');
    writeFileSync(join(dir, 'babel.mjs'), 'export function transformSync() { process.exit(1); }\n');
    const dying = createPool({
      size: 1,
      babel: join(dir, 'babel.mjs'),
      compiler: p.compiler,
      cwd: dir,
      options,
    });
    assert.deepEqual(await dying.compile({ path: 'a.tsx', text: 'x', parser: ['jsx'] }), {
      error: 'compiler-error',
    });
    // The next task gets a new worker.
    assert.deepEqual(await dying.compile({ path: 'a.tsx', text: 'x', parser: ['jsx'] }), {
      error: 'compiler-error',
    });
    assert.equal(dying.started, 2);
    await dying.close();
    const ok = createPool({ size: 2, ...p, cwd: tempDir('cwd'), options });
    const r = await ok.compile({
      path: 'a.tsx',
      text: 'export function A() { return <a />; }\n',
      parser: ['jsx', 'typescript'],
    });
    assert.deepEqual('functions' in r && r.functions.map((f) => f.name), ['A']);
    await ok.close();
  }
);
