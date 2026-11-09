/**
 * react-oxc.test.mjs — `react.compiler: "oxc"`, the engine's built-in React Compiler
 * (lib/react/backend.mjs): a run with no Babel installed, the same alerts as the Babel plugin, the
 * cache, the choice over an installed Babel plugin, "babel" without it, an engine built without
 * the `react-oxc` feature, the dashboard's status (no "not installed" for "oxc"), and the compiler
 * named in doctor, `pxsig react`, pxsig_react and SARIF.
 *
 *   node --test packages/pxsig/test/react-oxc.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compilerName, oxcVersion } from '../src/lib/react/backend.mjs';
import { reactData } from '../src/lib/react/data.mjs';
import { reactFindings } from '../src/lib/react/doctor.mjs';
import { analyse } from '../src/lib/react/index.mjs';
import { reactSarifLog } from '../src/lib/sarif-react.mjs';
import { tools } from '../src/tools/index.mjs';
import { hasRust, rustBin, testEnv, testHome } from './fixture.mjs';
import { hasCompiler, projectAt, reactProject } from './react-helpers.mjs';
import { skipOn, skipUnless } from './strict.mjs';

/** @import { ReactRun, ReactToolResult } from '../src/types/react.js' */

const built = hasRust ? oxcVersion(rustBin) : null;
const skip = skipUnless(
  built && 'version' in built,
  'the engine is missing, or built without the react-oxc feature'
);
const skipBoth = skip || skipUnless(hasCompiler, 'the React Compiler test fixtures are missing');
const cli = fileURLToPath(new URL('../bin/pxsig.mjs', import.meta.url));
const OXC = { react: { compiler: 'oxc' } };

/**
 * @param {ReactRun} r
 * @returns {Extract<ReactRun, { ran: true }>}
 */
const ran = (r) => {
  assert.ok(r.ran, JSON.stringify(r));
  return r;
};

test(
  '"oxc" with no Babel installed: the same alerts as the Babel plugin, then cached',
  { skip },
  async (t) => {
    const P = projectAt(reactProject(t, { babel: null, config: OXC }));
    const r = ran(await analyse(P));
    assert.deepEqual([r.compiled, r.workers], [2, 0]);
    const { backend } = r.report;
    assert.deepEqual(
      { ...backend, options: null },
      { name: 'oxc', compiler: '0.143.0', babel: null, options: null }
    );
    assert.deepEqual(
      r.report.alerts.map((a) => [a.id, a.change, a.level]),
      [
        ['src/Button/Button.tsx#Button', 'new-bailout', 'warning'],
        ['src/Button/Button.tsx#Card', 'new-finding', 'note'],
      ]
    );
    assert.equal(
      r.report.alerts[0].text,
      'Button (src/Button/Button.tsx): compiled at main, skipped now: Cannot access refs during render (refs, line 4). Reaches 2 entries.'
    );
    const again = ran(await analyse(P));
    assert.deepEqual([again.compiled, again.report.summary.cached], [0, 2]);
    assert.deepEqual(again.report.alerts, r.report.alerts);
    assert.deepEqual(
      reactFindings(P).map((f) => f.text),
      ['oxc_react_compiler 0.143.0 (built-in, experimental): react.compiler is "oxc"']
    );
  }
);

test('the dashboard: "oxc" needs no packages; "babel" without them is not installed', (t) => {
  const status = (/** @type {Record<string, unknown>} */ config) => {
    // A check that counted renders: data.react without a server or a react.json.
    const P = projectAt(reactProject(t, { babel: null, config }));
    const d = reactData(P, { check: { rows: [{ renders: null }] } });
    return d && [d.status.compiler, d.status.missing];
  };
  assert.deepEqual(status(OXC), ['ready', []]);
  assert.deepEqual(status({ react: { compiler: 'babel' } }), [
    'not-installed',
    ['babel-plugin-react-compiler', '@babel/core'],
  ]);
});

test(
  '"oxc" over an installed Babel plugin; "babel" without one is not installed',
  { skip: skipBoth },
  async (t) => {
    const both = projectAt(reactProject(t, { config: OXC }));
    const r = ran(await analyse(both));
    assert.equal(r.report.backend.name, 'oxc');
    // The cache is per compiler: Babel's results are not the built-in compiler's.
    const babel = projectAt(reactProject(t, { config: { react: { compiler: 'babel' } } }));
    assert.equal(ran(await analyse(babel)).report.backend.name, 'babel');
    const none = projectAt(
      reactProject(t, { babel: null, config: { react: { compiler: 'babel' } } })
    );
    const n = await analyse(none);
    assert.deepEqual([n.ran, !n.ran && n.why], [false, 'not-installed']);
    assert.deepEqual(
      reactFindings(none).map((f) => f.text),
      ['babel-plugin-react-compiler and @babel/core not installed: compiler analysis skipped']
    );
  }
);

test('"oxc" names the compiler in pxsig react, pxsig_react and the SARIF', { skip }, async (t) => {
  const dir = reactProject(t, { babel: null, config: OXC });
  const out = spawnSync(process.execPath, [cli, 'react', '--sarif', 'react.sarif'], {
    cwd: dir,
    env: testEnv(testHome, { PXSIG_FORMAT: 'plain', PXSIG_NO_DELEGATE: '1' }),
    encoding: 'utf8',
  });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /compiler: oxc_react_compiler 0\.143\.0 \(built-in, experimental\)/);
  const sarif = JSON.parse(readFileSync(join(dir, 'react.sarif'), 'utf8'));
  assert.equal(sarif.runs[0].tool.extensions[0].name, 'oxc_react_compiler');
  const was = process.env.PXSIG_WORKSPACE;
  process.env.PXSIG_WORKSPACE = dir;
  try {
    const tool = /** @type {{ run: (a: Record<string, unknown>) => Promise<unknown> }} */ (
      tools.find((x) => x.name === 'pxsig_react')
    );
    const r = /** @type {ReactToolResult} */ (await tool.run({}));
    assert.ok(r.ran, JSON.stringify(r));
    assert.deepEqual(r.backend, {
      name: 'oxc',
      compiler: '0.143.0',
      babel: null,
      label: 'oxc_react_compiler 0.143.0 (built-in, experimental)',
    });
  } finally {
    if (was === undefined) delete process.env.PXSIG_WORKSPACE;
    else process.env.PXSIG_WORKSPACE = was;
  }
});

test('the SARIF names the compiler as its tool extension', () => {
  const ext = (/** @type {'babel' | 'oxc'} */ name, /** @type {string} */ compiler) =>
    reactSarifLog({ backend: { name, compiler } }).runs[0].tool.extensions;
  assert.deepEqual(ext('oxc', '0.143.0'), [
    { name: 'oxc_react_compiler', version: '0.143.0', properties: { builtIn: true } },
  ]);
  assert.deepEqual(ext('babel', '1.0.0'), [
    { name: 'babel-plugin-react-compiler', version: '1.0.0', properties: { builtIn: false } },
  ]);
  assert.equal(reactSarifLog({}).runs[0].tool.extensions, undefined);
  assert.equal(
    compilerName({ name: 'babel', compiler: '1.0.0', babel: '7.29.7' }),
    'babel-plugin-react-compiler 1.0.0 with @babel/core 7.29.7'
  );
});

test(
  'an engine built without react-oxc: the run and doctor say so, no path',
  { skip: skipOn('the stand-in engine is a script') },
  async (t) => {
    const dir = reactProject(t, { babel: null, config: OXC });
    // A stand-in for an engine built without the feature: react-compile exits 2 and says why.
    mkdirSync(join(dir, 'old-engine'));
    const bin = join(dir, 'old-engine', 'pxsig');
    writeFileSync(
      bin,
      `#!/usr/bin/env node
process.stderr.write('error: this engine is built without the React Compiler (cargo feature react-oxc) at ' + __filename + '\\n');
process.exit(2);
`
    );
    chmodSync(bin, 0o755);
    const P = { ...projectAt(dir), rustBin: bin };
    assert.deepEqual(oxcVersion(bin), {
      why: 'this engine is built without the built-in React Compiler',
    });
    assert.deepEqual(await analyse(P), {
      ran: false,
      why: 'failed',
      text: 'react: compiler analysis skipped: this engine is built without the built-in React Compiler (react.compiler: "oxc")',
    });
    assert.deepEqual(
      reactFindings(P).map((f) => f.text),
      [
        'react.compiler is "oxc", but this engine is built without the built-in React Compiler: compiler analysis skipped',
      ]
    );
  }
);
