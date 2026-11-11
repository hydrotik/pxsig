import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leftLinks } from './lib/doc-links.mjs';

/** @typedef {{ name: string, version: string, license?: string, repository?: { type: string, url: string }, os?: string[], cpu?: string[], libc?: string[], files?: string[], bin?: unknown, type?: string, main?: string, exports?: unknown, author?: string, homepage?: string, bugs?: { url: string } }} PlatformManifest */

const script = fileURLToPath(new URL('./make-platform-packages.mjs', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));
const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64'];
/** @param {string} id */
const exeOf = (id) => (id.startsWith('win32-') ? 'pxsig.exe' : 'pxsig');

/** @param {string[]} args */
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

/**
 * A temp folder holding `artifacts/pxsig-<id>/pxsig[.exe]` for each id, as download-artifact lays
 * them out in the release's pack job.
 * @param {string[]} ids
 */
function artifacts(ids) {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-platform-packages-'));
  for (const id of ids) {
    mkdirSync(join(dir, 'artifacts', `pxsig-${id}`), { recursive: true });
    writeFileSync(join(dir, 'artifacts', `pxsig-${id}`, exeOf(id)), `engine for ${id}\n`);
  }
  return dir;
}

/**
 * @param {string} out
 * @param {string} id
 * @returns {PlatformManifest}
 */
const manifestOf = (out, id) =>
  /** @type {PlatformManifest} */ (
    JSON.parse(readFileSync(join(out, `cli-${id}`, 'package.json'), 'utf8'))
  );

test('every platform package is named, restricted and laid out as rustBinary() resolves it', () => {
  const dir = artifacts(PLATFORMS);
  try {
    const out = join(dir, 'out');
    const r = run(['--version', '1.2.3', '--artifacts', join(dir, 'artifacts'), '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    for (const id of PLATFORMS) {
      const [platform, arch] = id.split('-');
      const m = manifestOf(out, id);
      assert.equal(m.name, `@pxsig/cli-${id}`);
      assert.equal(m.version, '1.2.3');
      assert.deepEqual(m.os, [platform]);
      assert.deepEqual(m.cpu, [arch]);
      // The Linux binaries are glibc builds (*-unknown-linux-gnu); other platforms have no libc.
      assert.deepEqual(m.libc, platform === 'linux' ? ['glibc'] : undefined, `${id}: libc`);
      // The engine is found by path, not run through a `bin` link.
      assert.equal(m.bin, undefined, `${id}: bin`);
      assert.deepEqual(m.files, ['bin', 'index.js', 'index.cjs', 'test', 'LICENSE']);
      assert.equal(m.license, 'MIT');
      assert.equal(m.repository?.url, 'git+https://github.com/hydrotik/pxsig.git');
      // Registry scanners (Socket) read these: author, website, bug tracker, an entry, a test.
      assert.equal(m.author, 'Donovan Adams (Hydrotik LLC)');
      assert.equal(m.homepage, 'https://github.com/hydrotik/pxsig#readme');
      assert.deepEqual(m.bugs, { url: 'https://github.com/hydrotik/pxsig/issues' });
      // ESM (Socket's check), with a CommonJS entry for `require` and the binary exported by path.
      assert.equal(m.type, 'module');
      assert.equal(m.main, 'index.cjs');
      assert.deepEqual(m.exports, {
        '.': { import: './index.js', require: './index.cjs' },
        './bin/*': './bin/*',
        './package.json': './package.json',
      });
      assert.ok(existsSync(join(out, `cli-${id}`, 'test', 'binary.test.js')), `${id}: self-test`);
      const bin = join(out, `cli-${id}`, 'bin', exeOf(id));
      assert.equal(readFileSync(bin, 'utf8'), `engine for ${id}\n`, `${id}: bin/${exeOf(id)}`);
      assert.ok(existsSync(join(out, `cli-${id}`, 'README.md')));
      assert.equal(
        readFileSync(join(out, `cli-${id}`, 'LICENSE'), 'utf8'),
        readFileSync(join(repo, 'LICENSE'), 'utf8'),
        `${id}: LICENSE is the root licence`
      );
    }
    // rustBinary() (packages/pxsig/src/lib/workspace/peers.mjs) resolves the same name and path.
    const workspace = readFileSync(
      join(repo, 'packages/pxsig/src/lib/workspace/peers.mjs'),
      'utf8'
    );
    assert.ok(
      workspace.includes('`@pxsig/cli-${process.platform}-${process.arch}/bin/${exe}`'),
      'rustBinary resolves @pxsig/cli-<platform>-<arch>/bin/<exe>'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('each README names its package, platform, target and binary, with links pinned to the version', () => {
  const dir = artifacts(PLATFORMS);
  try {
    const out = join(dir, 'out');
    const r = run(['--version', '1.2.3', '--artifacts', join(dir, 'artifacts'), '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    const release = readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8');
    for (const id of PLATFORMS) {
      const [platform, arch] = id.split('-');
      const md = readFileSync(join(out, `cli-${id}`, 'README.md'), 'utf8');
      assert.doesNotMatch(md, /\{\{\w+\}\}/, `${id}: every placeholder is filled`);
      assert.match(md, new RegExp(`^# @pxsig/cli-${id}$`, 'm'), `${id}: title`);
      assert.ok(
        md.replace(/\s+/g, ' ').includes(`\`os: ["${platform}"]\` and \`cpu: ["${arch}"]\``),
        `${id}: os/cpu`
      );
      assert.ok(md.includes(`\`@pxsig/cli-${id}/bin/${exeOf(id)}\``), `${id}: binary path`);
      assert.ok(md.includes('`PXSIG_BIN`'), `${id}: the override`);
      const target = /the target `([^`]+)`/.exec(md)?.[1];
      assert.ok(
        target && release.includes(`target: ${target},`),
        `${id}: release.yml builds ${target}`
      );
      const asset = `pxsig-${id}${platform === 'win32' ? '.exe' : ''}`;
      assert.ok(md.includes(`release's \`${asset}\``), `${id}: release asset`);
      assert.ok(md.includes('/blob/v1.2.3/docs/releasing.md#verifying-a-release'), `${id}: pinned`);
      // What `pack-manifest.mjs --check` refuses in a packed README: links to main, or to a file
      // the package does not hold.
      assert.deepEqual(
        leftLinks(md, (p) => ['LICENSE', 'index.js', 'index.cjs'].includes(p)),
        [],
        id
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'a generated platform package packs with its LICENSE, README.md and binary',
  {
    skip:
      spawnSync('npm', ['--version'], { shell: process.platform === 'win32' }).status !== 0 &&
      'npm is not on PATH',
  },
  () => {
    const dir = artifacts(['linux-x64']);
    try {
      const out = join(dir, 'out');
      const args = ['--artifacts', join(dir, 'artifacts'), '--out', out, '--only', 'linux-x64'];
      const r = run(['--version', '1.2.3', ...args]);
      assert.equal(r.status, 0, r.stderr);
      const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: join(out, 'cli-linux-x64'),
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
      assert.equal(pack.status, 0, pack.stderr);
      /** @type {{ files: { path: string }[] }[]} */
      const [packed] = JSON.parse(pack.stdout);
      assert.deepEqual(packed.files.map((f) => f.path).sort(), [
        'LICENSE',
        'README.md',
        'bin/pxsig',
        'index.cjs',
        'index.js',
        'package.json',
        'test/binary.test.js',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "a platform package's entry is its binary's path, and its self-test runs the binary",
  { skip: process.platform === 'win32' && 'the stand-in engine is a shell script' },
  () => {
    const dir = artifacts([]);
    try {
      const id = 'linux-x64';
      const src = join(dir, 'artifacts', `pxsig-${id}`);
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'pxsig'), '#!/bin/sh\necho "pxsig 1.2.3"\n');
      // Where npm installs it, beside the pxsig that looks it up.
      const out = join(dir, 'node_modules', '@pxsig');
      const r = run([
        '--version',
        '1.2.3',
        '--artifacts',
        join(dir, 'artifacts'),
        '--out',
        out,
        '--only',
        id,
      ]);
      assert.equal(r.status, 0, r.stderr);
      const pkg = join(out, `cli-${id}`);
      // __dirname and import.meta.url are the real path (macOS's temp folder is behind a symlink).
      const binary = join(realpathSync(pkg), 'bin', 'pxsig');
      const required = spawnSync(process.execPath, ['-p', `require(${JSON.stringify(pkg)})`], {
        encoding: 'utf8',
      });
      assert.equal(required.stdout.trim(), binary, required.stderr);
      // As rustBinary() resolves it (require) and as an ES module importer would (import).
      const probe = join(dir, 'node_modules', 'pxsig', 'probe.mjs');
      mkdirSync(dirname(probe), { recursive: true });
      writeFileSync(
        probe,
        `import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const name = '@pxsig/cli-${id}';
console.log(JSON.stringify({
  require: createRequire(import.meta.url).resolve(\`\${name}/bin/pxsig\`),
  import: fileURLToPath(import.meta.resolve(\`\${name}/bin/pxsig\`)),
  default: (await import(name)).default,
}));
`
      );
      const resolved = spawnSync(process.execPath, [probe], { encoding: 'utf8' });
      assert.equal(resolved.status, 0, resolved.stderr);
      assert.deepEqual(JSON.parse(resolved.stdout), {
        require: binary,
        import: binary,
        default: binary,
      });
      // A run of its own, not a subtest of this one (node:test sets NODE_TEST_CONTEXT).
      const { NODE_TEST_CONTEXT: _, ...env } = process.env;
      const self = spawnSync(process.execPath, ['--test'], { cwd: pkg, encoding: 'utf8', env });
      assert.equal(self.status, 0, self.stdout + self.stderr);
      assert.match(self.stdout, /^# pass 2$/m);
      // A binary that does not run fails it.
      writeFileSync(join(pkg, 'bin', 'pxsig'), '#!/bin/sh\nexit 1\n');
      assert.notEqual(spawnSync(process.execPath, ['--test'], { cwd: pkg, env }).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test('--write-optional-deps pins every generated package at the version, sorted, keeping others', () => {
  const dir = artifacts(['linux-x64', 'win32-x64']);
  try {
    const pj = join(dir, 'package.json');
    writeFileSync(
      pj,
      JSON.stringify({ name: 'pxsig', version: '0.0.1', optionalDependencies: { zzz: '1.0.0' } })
    );
    const r = run([
      '--version',
      '0.0.0-ci',
      '--artifacts',
      join(dir, 'artifacts'),
      '--out',
      join(dir, 'out'),
      '--allow-missing',
      '--write-optional-deps',
      pj,
    ]);
    assert.equal(r.status, 0, r.stderr);
    /** @type {{ version: string, repository?: { url: string }, optionalDependencies: Record<string, string> }} */
    const after = JSON.parse(readFileSync(pj, 'utf8'));
    assert.equal(after.version, '0.0.0-ci');
    assert.deepEqual(after.optionalDependencies, {
      '@pxsig/cli-linux-x64': '0.0.0-ci',
      '@pxsig/cli-win32-x64': '0.0.0-ci',
      zzz: '1.0.0',
    });
    assert.equal(after.repository?.url, 'git+https://github.com/hydrotik/pxsig.git');
    assert.match(r.stderr, /skipping darwin-arm64/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--only builds the platforms named; a missing binary fails unless --allow-missing', () => {
  const dir = artifacts(['darwin-arm64']);
  try {
    const base = ['--version', '1.0.0', '--artifacts', join(dir, 'artifacts')];
    const only = run([...base, '--out', join(dir, 'a'), '--only', 'darwin-arm64']);
    assert.equal(only.status, 0, only.stderr);
    assert.ok(existsSync(join(dir, 'a', 'cli-darwin-arm64', 'package.json')));
    assert.ok(!existsSync(join(dir, 'a', 'cli-linux-x64')));
    const missing = run([...base, '--out', join(dir, 'b')]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing binaries/);
    assert.ok(!existsSync(join(dir, 'b')), 'nothing is written when a binary is missing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('usage errors exit 2', () => {
  for (const args of [
    [],
    ['--version', 'one', '--artifacts', '.', '--out', 'x'],
    ['--version', '1.0.0', '--artifacts', '.', '--out', 'x', '--only', 'plan9-mips'],
    ['--bogus'],
  ])
    assert.equal(run(args).status, 2, args.join(' '));
});
