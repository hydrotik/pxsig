// The package's subpath exports as a consumer resolves them from node_modules: `pxsig/workspace`
// gives the documented resolver functions and nothing else; `pxsig/dashboard` is types only and
// says so when Node loads it; `pxsig/diff-viewer` stays TypeScript source for a bundler;
// `pxsig/workspace` and `pxsig/psig` carry types a TypeScript consumer resolves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTree, tempDir } from './fixture.mjs';

const pkgDir = fileURLToPath(new URL('../', import.meta.url));
/** What README.md documents for `pxsig/workspace`. */
const WORKSPACE = ['SetupError', 'findWorkspace', 'loadProject', 'openProject', 'pickProject'];

/**
 * Lay the package out as npm installs it (package.json and src/) and run `body` with a resolver
 * rooted beside it.
 * @param {(resolve: (spec: string) => string) => Promise<void>} body
 */
async function installed(body) {
  const root = tempDir('exports');
  try {
    const pkg = join(root, 'node_modules', 'pxsig');
    mkdirSync(pkg, { recursive: true });
    copyFileSync(join(pkgDir, 'package.json'), join(pkg, 'package.json'));
    copyTree(join(pkgDir, 'src'), join(pkg, 'src'));
    const require = createRequire(join(root, 'index.js'));
    await body((spec) => require.resolve(spec));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('pxsig/workspace exports exactly the documented resolver functions', async () => {
  await installed(async (resolve) => {
    const mod = await import(pathToFileURL(resolve('pxsig/workspace')).href);
    assert.deepEqual(Object.keys(mod).sort(), WORKSPACE);
    for (const name of WORKSPACE) assert.equal(typeof mod[name], 'function', name);
    assert.throws(
      () => mod.openProject({ cwd: join(resolve('pxsig/workspace'), '..'), env: {} }),
      mod.SetupError
    );
  });
});

test('pxsig/dashboard is types only: loading it in Node throws a clear error', async () => {
  await installed(async (resolve) => {
    await assert.rejects(import(pathToFileURL(resolve('pxsig/dashboard')).href), {
      message: /^pxsig\/dashboard is types only: import it from TypeScript/,
    });
  });
});

test('the manifest keeps the TypeScript entries and declares React and Playwright as optional peers', async () => {
  const require = createRequire(import.meta.url);
  const manifest = require('../package.json');
  assert.equal(manifest.exports['./dashboard'].types, './dashboard/src/ui/contract.ts');
  assert.deepEqual(manifest.exports['./diff-viewer'], {
    types: './dashboard/src/diff-viewer/index.ts',
    default: './dashboard/src/diff-viewer/index.ts',
  });
  assert.match(manifest.peerDependencies.react, /^>=\d+$/);
  assert.equal(manifest.peerDependenciesMeta.react.optional, true);
  // Optional, so npm does not install the newest Playwright on its own; renders need it.
  assert.match(manifest.peerDependencies.playwright, /^>=\d+\.\d+$/);
  assert.equal(manifest.peerDependenciesMeta.playwright.optional, true);
});

test('pxsig/workspace and pxsig/psig carry types a TypeScript consumer resolves', async () => {
  // tsc and @types/node from the repository's own install (scripts/typecheck.mjs runs it the same way).
  const repoRequire = createRequire(join(pkgDir, '..', '..', 'package.json'));
  const tsPkg = repoRequire.resolve('typescript/package.json');
  const tsc = join(tsPkg, '..', JSON.parse(readFileSync(tsPkg, 'utf8')).bin.tsc);
  const nodeTypes = join(repoRequire.resolve('@types/node/package.json'), '..', '..');
  await installed(async (resolve) => {
    const root = join(resolve('pxsig/workspace'), '..', '..', '..', '..', '..');
    writeFileSync(
      join(root, 'consumer.mts'),
      [
        "import { SetupError, openProject } from 'pxsig/workspace';",
        "import { hasImage, readHeader, type PsigHeader } from 'pxsig/psig';",
        '// @ts-expect-error: an internal name, not exported',
        "import { runManifest } from 'pxsig/workspace';",
        "const name: string = openProject({ cwd: '.' }).name;",
        "const header: PsigHeader | null = readHeader('x.psig');",
        "const image: boolean = hasImage('x.psig');",
        "const err: Error = new SetupError('no', { code: 'x' });",
        'export { name, header, image, err, runManifest };',
      ].join('\n')
    );
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'es2022',
          strict: true,
          noEmit: true,
          types: ['node'],
          typeRoots: [nodeTypes],
        },
        files: ['consumer.mts'],
      })
    );
    const r = spawnSync(process.execPath, [tsc, '-p', root], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
