import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendBundled,
  bundledPackages,
  dashboardPackages,
  licenseOf,
  REF_PREFIX,
} from './bundle-sbom.mjs';
import { buildRecord, format, gitState } from './build-record.mjs';

const script = fileURLToPath(new URL('./bundle-sbom.mjs', import.meta.url));
const store = '../../node_modules/.pnpm';

// A built dashboard whose bundle names packages the way an unminified Vite build does, and a
// node_modules tree (under `base/..`) holding some of their package.json files.
const BUNDLE = [
  `// ${store}/@scope+ui@1.9.0_@types+react@19.3.0_react@19.3.0/node_modules/@scope/ui/esm/Button.mjs`,
  `// ${store}/@scope+ui@1.9.0_@types+react@19.3.0_react@19.3.0/node_modules/@scope/ui/esm/Menu.mjs`,
  `// ${store}/charts@3.7.0_redux@5.0.1/node_modules/charts/es6/index.js`,
  `// ${store}/charts@3.7.0_redux@5.0.1/node_modules/redux/dist/redux.mjs`,
  `// ${store}/redux@5.0.1/node_modules/redux/dist/redux.mjs`,
  `// ${store}/immer@10.2.0/node_modules/immer/dist/immer.mjs`,
  `// ${store}/immer@11.1.4/node_modules/immer/dist/immer.mjs`,
  `// ../../node_modules/flat-pkg/index.js`,
  `// ../../src/app/App.tsx`,
  'var x = 1;',
].join('\n');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-bundle-sbom-'));
  const base = join(root, 'repo', 'packages', 'dashboard');
  const dash = join(root, 'dist', 'dashboard');
  mkdirSync(join(dash, 'assets'), { recursive: true });
  writeFileSync(join(dash, 'assets', 'app.js'), BUNDLE);
  writeFileSync(join(dash, 'index.html'), '<!doctype html>');
  /** @param {string} rel @param {object} pj */
  const pkg = (rel, pj) => {
    const dir = join(base, rel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pj));
  };
  pkg(`${store}/@scope+ui@1.9.0_@types+react@19.3.0_react@19.3.0/node_modules/@scope/ui`, {
    license: 'MIT',
  });
  pkg(`${store}/charts@3.7.0_redux@5.0.1/node_modules/charts`, { license: 'MIT AND ISC' });
  pkg(`${store}/redux@5.0.1/node_modules/redux`, { licenses: [{ type: 'MIT' }] });
  pkg('../../node_modules/flat-pkg', { version: '2.0.0', license: 'ISC' });
  return { root, base, dash };
}

const SBOM = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  components: [
    { type: 'library', name: 'pxsig', 'bom-ref': 'i|pxsig@1.0.0', purl: 'pkg:npm/pxsig@1.0.0' },
  ],
  dependencies: [
    { ref: 'i', dependsOn: ['i|pxsig@1.0.0'] },
    { ref: 'i|pxsig@1.0.0', dependsOn: [] },
  ],
};

test('the packages come from the pnpm store paths, one per name and version, sorted', () => {
  const pkgs = bundledPackages(BUNDLE).map((p) => `${p.name}@${p.version ?? '?'}`);
  // charts' own link to redux is not an entry; the flat path has no version until resolved.
  assert.deepEqual(pkgs, [
    '@scope/ui@1.9.0',
    'charts@3.7.0',
    'flat-pkg@?',
    'immer@10.2.0',
    'immer@11.1.4',
    'redux@5.0.1',
  ]);
});

test('licences and flat versions are read from package.json; BUILD.json wins when present', () => {
  const { root, base, dash } = fixture();
  try {
    const got = () =>
      Object.fromEntries(
        dashboardPackages(dash, base).packages.map((p) => [`${p.name}@${p.version}`, p.license])
      );
    assert.deepEqual(got(), {
      '@scope/ui@1.9.0': 'MIT',
      'charts@3.7.0': 'MIT AND ISC',
      'flat-pkg@2.0.0': 'ISC',
      'immer@10.2.0': null,
      'immer@11.1.4': null,
      'redux@5.0.1': 'MIT',
    });
    writeFileSync(
      join(dash, 'BUILD.json'),
      JSON.stringify({ bundled: [{ name: 'immer', version: '11.1.4', license: 'MIT' }] })
    );
    assert.equal(got()['immer@11.1.4'], 'MIT');
    assert.equal(dashboardPackages(dash, base).file, 'dist/dashboard/assets/app.js');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('licenseOf reads `license` and the old `licenses` list', () => {
  assert.equal(licenseOf({ license: 'MIT' }), 'MIT');
  assert.equal(licenseOf({ license: { type: 'ISC' } }), 'ISC');
  assert.equal(
    licenseOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }),
    '(MIT OR Apache-2.0)'
  );
  assert.equal(licenseOf({}), null);
});

test('components are appended with purls, licences and a dependency of pxsig, once', () => {
  const pkgs = [
    { name: '@scope/ui', version: '1.9.0', path: 'x', license: 'MIT' },
    { name: 'charts', version: '3.7.0', path: 'y', license: '(MIT OR ISC)' },
    { name: 'odd', version: '1.0.0', path: 'z', license: 'SEE LICENSE IN LICENSE.md' },
  ];
  const once = appendBundled(SBOM, pkgs, 'dist/dashboard/assets/app.js');
  assert.deepEqual(appendBundled(once, pkgs, 'dist/dashboard/assets/app.js'), once);
  const [ui, charts, odd] = /** @type {any[]} */ (once.components).slice(1);
  assert.deepEqual(ui, {
    type: 'library',
    'bom-ref': `${REF_PREFIX}@scope/ui@1.9.0`,
    group: '@scope',
    name: 'ui',
    version: '1.9.0',
    licenses: [{ license: { id: 'MIT' } }],
    purl: 'pkg:npm/%40scope/ui@1.9.0',
    properties: [
      { name: 'cdx:npm:package:bundled', value: 'true' },
      { name: 'pxsig:bundled-in', value: 'dist/dashboard/assets/app.js' },
    ],
  });
  assert.deepEqual(charts.licenses, [{ expression: 'MIT OR ISC' }]);
  assert.deepEqual(odd.licenses, [{ license: { name: 'SEE LICENSE IN LICENSE.md' } }]);
  assert.deepEqual(once.dependencies?.[1].dependsOn, [
    `${REF_PREFIX}@scope/ui@1.9.0`,
    `${REF_PREFIX}charts@3.7.0`,
    `${REF_PREFIX}odd@1.0.0`,
  ]);
  assert.equal(once.dependencies?.length, 5);
});

test('the CLI rewrites the SBOM in place, deterministically, and checks its arguments', () => {
  const { root, base, dash } = fixture();
  try {
    const file = join(root, 'pxsig-npm.cdx.json');
    writeFileSync(file, JSON.stringify(SBOM));
    const run = () =>
      spawnSync(process.execPath, [script, '--dashboard', dash, '--sbom', file, '--base', base], {
        encoding: 'utf8',
      });
    assert.equal(run().status, 0);
    const first = readFileSync(file, 'utf8');
    assert.equal(run().stdout.trim().split(' ')[1], '6');
    assert.equal(readFileSync(file, 'utf8'), first);
    assert.equal(JSON.parse(first).components.length, 7);
    assert.equal(spawnSync(process.execPath, [script, '--dashboard', dash]).status, 2);
    assert.equal(
      spawnSync(process.execPath, [script, '--dashboard', dash, '--sbom', join(root, 'none')])
        .status,
      1
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('BUILD.json records the design-system commit, a dirty tree, the lock hashes and the bundle', () => {
  const { root, base, dash } = fixture();
  try {
    const ds = join(root, 'ds');
    mkdirSync(ds);
    writeFileSync(join(ds, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    /** @param {string[]} a */
    const git = (...a) =>
      spawnSync(
        'git',
        [
          '-C',
          ds,
          '-c',
          'user.name=t',
          '-c',
          'user.email=t@example.invalid',
          '-c',
          'commit.gpgsign=false',
          ...a,
        ],
        {
          encoding: 'utf8',
        }
      );
    if (git('init', '-q').status !== 0) return; // no git here: nothing to check
    git('add', '.');
    git('commit', '-qm', 'one');
    const head = git('rev-parse', 'HEAD').stdout.trim();
    assert.deepEqual(gitState(ds), { commit: head, dirty: false });
    mkdirSync(join(ds, 'sub'));
    assert.equal(gitState(join(ds, 'sub')), null);
    writeFileSync(join(ds, 'pnpm-lock.yaml'), 'changed\n');
    const lock = join(root, 'pnpm-lock.yaml');
    writeFileSync(lock, 'x');
    const r = buildRecord({
      outDir: dash,
      adapter: 'plain',
      dsSource: ds,
      lockFile: lock,
      sourceDateEpoch: '1700000000',
      base,
    });
    assert.deepEqual(r.designSystem, {
      commit: head,
      dirty: true,
      lockSha256: createHash('sha256').update('changed\n').digest('hex'),
    });
    assert.equal(r.lockSha256, '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881');
    assert.equal(r.builtAt, '2023-11-14T22:13:20.000Z');
    assert.equal(r.bundled.length, 6);
    assert.equal(buildRecord({ outDir: dash, adapter: 'plain', base }).designSystem, null);
    const text = format(r);
    assert.deepEqual(JSON.parse(text), r);
    assert.match(text, /\n {4}\{"name":"@scope\/ui","version":"1\.9\.0","license":"MIT"\},\n/);
    assert.ok(!text.includes(root) && !text.includes(dirname(root)), 'no paths');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
