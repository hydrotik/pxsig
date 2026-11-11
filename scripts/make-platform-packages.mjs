#!/usr/bin/env node
/**
 * make-platform-packages.mjs — build the per-platform npm packages that carry the `pxsig` binary.
 *
 *   node scripts/make-platform-packages.mjs --version 0.2.0 --artifacts <dir> --out <dir>
 *     [--only darwin-arm64,linux-x64] [--write-optional-deps packages/pxsig/package.json]
 *     [--allow-missing] [--dry-run]
 *
 * For every platform it writes `<out>/cli-<platform>-<arch>/` holding a package.json
 * (`@pxsig/cli-<platform>-<arch>`, restricted by `os`/`cpu`), a README.md (scripts/platform-readme.md,
 * filled in; each `target` is the Rust target release.yml builds), the root LICENSE,
 * index.js and index.cjs (the binary's path, for `import` and `require`), test/binary.test.js
 * (`node --test`: runs the binary) and `bin/pxsig` (`bin/pxsig.exe` on win32), copied from
 * `<artifacts>/pxsig-<platform>-<arch>/pxsig[.exe]` — the layout `actions/download-artifact`
 * produces for the release workflow's build artifacts.
 *
 * The `pxsig` package lists these as optionalDependencies, so a package manager installs only the
 * one matching the host. `rustBinary()` in packages/pxsig/src/lib/workspace/peers.mjs resolves
 * `@pxsig/cli-${process.platform}-${process.arch}/bin/${exe}`; the names and paths here must match,
 * and `exports` must keep `./bin/*` (a package with an exports map resolves no other subpath).
 *
 * --write-optional-deps <package.json> sets `version` and adds or updates an exact-version
 * optionalDependency for every package generated in this run (and fills `repository` when it is
 * missing). The release workflow runs it on its own checkout; the result is never committed.
 *
 * The output directory is generated: put it under a git-ignored path (packages/cli-*\/ or dist/).
 * Repository, license and author come from the Cargo workspace ([workspace.package]).
 * Node >= 20, no dependencies. Exit 1 on a failure, 2 on a usage error.
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {'version' | 'artifacts' | 'out' | 'only' | 'optionalDeps'} ValuedKey
 * @typedef {{ only: string | null, dryRun: boolean, allowMissing: boolean } & Partial<Record<Exclude<ValuedKey, 'only'>, string>>} RawOpts
 * @typedef {RawOpts & { version: string, artifacts: string, out: string }} Opts
 * @typedef {{ id: string, platform: string, arch: string, target: string, exe: string, src: string, dir: string, name: string }} Plan
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORMS = [
  { platform: 'darwin', arch: 'arm64', target: 'aarch64-apple-darwin' },
  { platform: 'darwin', arch: 'x64', target: 'x86_64-apple-darwin' },
  { platform: 'linux', arch: 'x64', target: 'x86_64-unknown-linux-gnu' },
  { platform: 'linux', arch: 'arm64', target: 'aarch64-unknown-linux-gnu' },
  { platform: 'win32', arch: 'x64', target: 'x86_64-pc-windows-msvc' },
];
const USAGE = `usage: node scripts/make-platform-packages.mjs --version <x.y.z> --artifacts <dir> --out <dir>
         [--only <platform-arch,...>] [--write-optional-deps <package.json>] [--allow-missing] [--dry-run]
platforms: ${PLATFORMS.map((p) => `${p.platform}-${p.arch}`).join(', ')}`;

/**
 * @param {string} msg
 * @returns {never}
 */
function usage(msg) {
  console.error(`[make-platform-packages] ${msg}\n${USAGE}`);
  process.exit(2);
}
/**
 * @param {string} msg
 * @returns {never}
 */
function fail(msg) {
  console.error(`[make-platform-packages] ${msg}`);
  process.exit(1);
}

/**
 * @param {string[]} argv
 * @returns {Opts}
 */
function parseArgs(argv) {
  /** @type {RawOpts} */
  const opts = { only: null, dryRun: false, allowMissing: false };
  /** @type {Record<string, ValuedKey | undefined>} */
  const valued = {
    '--version': 'version',
    '--artifacts': 'artifacts',
    '--out': 'out',
    '--only': 'only',
    '--write-optional-deps': 'optionalDeps',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--allow-missing') opts.allowMissing = true;
    else if (a.includes('=') && valued[a.slice(0, a.indexOf('='))])
      // The condition above found the key in `valued`.
      opts[/** @type {ValuedKey} */ (valued[a.slice(0, a.indexOf('='))])] = a.slice(
        a.indexOf('=') + 1
      );
    else if (valued[a]) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) usage(`${a} needs a value`);
      opts[valued[a]] = v;
    } else usage(`unknown argument: ${a}`);
  }
  if (!opts.version) usage('--version is required');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(opts.version))
    usage(`--version is not a semver version: ${opts.version}`);
  if (!opts.artifacts) usage('--artifacts is required');
  if (!opts.out) usage('--out is required');
  // version, artifacts and out are checked above (`usage` exits).
  return /** @type {Opts} */ (opts);
}

/** `key = "value"` lines of the [workspace.package] table of the root Cargo.toml (`key = ["value", …]`: the first). */
/** @returns {Record<string, string | undefined>} */
function cargoWorkspacePackage() {
  const f = join(root, 'Cargo.toml');
  if (!existsSync(f)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  let inTable = false;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[')) inTable = t === '[workspace.package]';
    else if (inTable) {
      const m = /^([A-Za-z0-9_-]+)\s*=\s*\[?\s*"([^"]*)"/.exec(t);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const cargo = cargoWorkspacePackage();
const license = cargo.license ?? 'MIT';
const repoUrl = cargo.repository;
const repository = repoUrl ? { type: 'git', url: `git+${repoUrl}.git` } : undefined;
const author = cargo.authors;

let targets = PLATFORMS;
if (opts.only) {
  const wanted = opts.only
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const known = new Set(PLATFORMS.map((p) => `${p.platform}-${p.arch}`));
  const unknown = wanted.filter((w) => !known.has(w));
  if (unknown.length) usage(`unknown platform(s) in --only: ${unknown.join(', ')}`);
  if (!wanted.length) usage('--only is empty');
  targets = PLATFORMS.filter((p) => wanted.includes(`${p.platform}-${p.arch}`));
}

const artifacts = resolve(opts.artifacts);
const out = resolve(opts.out);
if (!existsSync(artifacts)) fail(`artifacts directory not found: ${opts.artifacts}`);

/** @type {Plan[]} */
const plan = [];
/** @type {string[]} */
const missing = [];
for (const { platform, arch, target } of targets) {
  const id = `${platform}-${arch}`;
  const exe = platform === 'win32' ? 'pxsig.exe' : 'pxsig';
  const src = join(artifacts, `pxsig-${id}`, exe);
  if (!existsSync(src) || !statSync(src).isFile()) {
    missing.push(`${id}: expected ${src}`);
    continue;
  }
  plan.push({
    id,
    platform,
    arch,
    target,
    exe,
    src,
    dir: join(out, `cli-${id}`),
    name: `@pxsig/cli-${id}`,
  });
}
if (missing.length && !opts.allowMissing)
  fail(`missing binaries (use --allow-missing to skip them):\n  ${missing.join('\n  ')}`);
for (const m of missing) console.warn(`[make-platform-packages] skipping ${m}`);
if (!plan.length) fail('no platform packages to generate');

/** @param {Plan} p */
function manifest(p) {
  return {
    name: p.name,
    version: opts.version,
    description: `The pxsig binary for ${p.platform} ${p.arch}. Installed automatically as an optional dependency of pxsig.`,
    license,
    ...(author ? { author } : {}),
    ...(repository
      ? { repository, homepage: `${repoUrl}#readme`, bugs: { url: `${repoUrl}/issues` } }
      : {}),
    type: 'module',
    main: 'index.cjs',
    exports: {
      '.': { import: './index.js', require: './index.cjs' },
      // rustBinary() resolves bin/<exe> by name.
      './bin/*': './bin/*',
      './package.json': './package.json',
    },
    os: [p.platform],
    cpu: [p.arch],
    // The Linux binaries are built for *-unknown-linux-gnu: a musl host (Alpine) skips them.
    ...(p.platform === 'linux' ? { libc: ['glibc'] } : {}),
    files: ['bin', 'index.js', 'index.cjs', 'test', 'LICENSE'],
    preferUnplugged: true,
  };
}

/** @param {Plan} p */
function entry(p) {
  return `// The path of this package's pxsig binary. pxsig resolves bin/${p.exe} itself; this is for tools
// that import the package (index.cjs: for those that require it).
import { fileURLToPath } from 'node:url';

export default fileURLToPath(new URL('./bin/${p.exe}', import.meta.url));
`;
}

/** @param {Plan} p */
function entryCjs(p) {
  return `'use strict';
// The path of this package's pxsig binary, for \`require\` (index.js: for \`import\`).
module.exports = require('node:path').join(__dirname, 'bin', '${p.exe}');
`;
}

/** @param {Plan} p */
function selfTest(p) {
  return `// The binary in this package runs on this host, and \`import\`, \`require\` and the bin/ subpath
// resolve to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import bin from '../index.js';

const require = createRequire(import.meta.url);

test('bin/${p.exe} runs and prints its version', () => {
  const out = execFileSync(bin, ['--version'], { encoding: 'utf8' });
  assert.match(out.trim(), /^pxsig \\d+\\.\\d+\\.\\d+/);
});

test('import and require of ${p.name} give that path, and its bin/${p.exe} resolves to it', async () => {
  assert.equal((await import('${p.name}')).default, bin);
  assert.equal(require('${p.name}'), bin);
  assert.equal(require.resolve('${p.name}/bin/${p.exe}'), bin);
  assert.equal(fileURLToPath(import.meta.resolve('${p.name}/bin/${p.exe}')), bin);
});
`;
}

/** @type {Record<string, string>} */
const OS = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };
/** By id, else by arch. @type {Record<string, string>} */
const CPU = {
  'darwin-arm64': 'Apple silicon (arm64)',
  'darwin-x64': 'Intel (x64)',
  arm64: 'arm64 (AArch64)',
  x64: 'x64 (x86-64)',
};
const README = readFileSync(join(root, 'scripts', 'platform-readme.md'), 'utf8');

/**
 * scripts/platform-readme.md with its `{{key}}`s filled in. Its links are pinned to the version's
 * tag: `pack-manifest.mjs --check` refuses a packed README that links to `main`.
 * @param {Plan} p
 */
function readme(p) {
  /** @type {Record<string, string>} */
  const values = {
    name: p.name,
    platform: p.platform,
    arch: p.arch,
    exe: p.exe,
    target: p.target,
    asset: `pxsig-${p.id}${p.platform === 'win32' ? '.exe' : ''}`,
    os: OS[p.platform] ?? p.platform,
    cpu: CPU[p.id] ?? CPU[p.arch] ?? p.arch,
    version: opts.version,
    license,
  };
  return README.replace(/\{\{(\w+)\}\}/g, (/** @type {string} */ whole, /** @type {string} */ k) =>
    Object.hasOwn(values, k) ? values[k] : whole
  );
}

for (const p of plan) {
  const rel = (/** @type {string} */ f) => join(p.dir, f).slice(out.length + 1);
  if (opts.dryRun) {
    console.log(`[dry-run] ${p.name}@${opts.version}`);
    console.log(`  ${rel('package.json')}  os=${p.platform} cpu=${p.arch}`);
    console.log(`  ${rel('README.md')}`);
    console.log(`  ${rel('index.js')}`);
    console.log(`  ${rel('index.cjs')}`);
    console.log(`  ${rel('test/binary.test.js')}`);
    console.log(`  ${rel('LICENSE')}  <- ${join(root, 'LICENSE')}`);
    console.log(`  ${rel(`bin/${p.exe}`)}  <- ${p.src}`);
    continue;
  }
  rmSync(p.dir, { recursive: true, force: true });
  mkdirSync(join(p.dir, 'bin'), { recursive: true });
  mkdirSync(join(p.dir, 'test'), { recursive: true });
  writeFileSync(join(p.dir, 'package.json'), `${JSON.stringify(manifest(p), null, 2)}\n`);
  writeFileSync(join(p.dir, 'README.md'), readme(p));
  writeFileSync(join(p.dir, 'index.js'), entry(p));
  writeFileSync(join(p.dir, 'index.cjs'), entryCjs(p));
  writeFileSync(join(p.dir, 'test', 'binary.test.js'), selfTest(p));
  copyFileSync(join(root, 'LICENSE'), join(p.dir, 'LICENSE'));
  const bin = join(p.dir, 'bin', p.exe);
  copyFileSync(p.src, bin);
  chmodSync(bin, 0o755);
  console.log(`[make-platform-packages] ${p.name}@${opts.version} -> ${p.dir}`);
}

if (opts.optionalDeps) {
  const f = resolve(opts.optionalDeps);
  if (!existsSync(f)) fail(`--write-optional-deps: not found: ${opts.optionalDeps}`);
  /** @type {{ version?: string, repository?: unknown, optionalDependencies?: Record<string, string> }} */
  let pkg;
  try {
    // A package.json: an object (`version`, `repository` and `optionalDependencies` are read).
    pkg = /** @type {typeof pkg} */ (JSON.parse(readFileSync(f, 'utf8')));
  } catch (e) {
    fail(
      `--write-optional-deps: ${opts.optionalDeps} is not valid JSON: ${/** @type {Error} */ (e).message}`
    );
  }
  pkg.version = opts.version;
  if (!pkg.repository && repository) pkg.repository = repository;
  const deps = { ...pkg.optionalDependencies };
  for (const p of plan) deps[p.name] = opts.version;
  pkg.optionalDependencies = Object.fromEntries(
    Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))
  );
  if (opts.dryRun) {
    console.log(`[dry-run] ${opts.optionalDeps}: version ${opts.version}, optionalDependencies:`);
    for (const [k, v] of Object.entries(pkg.optionalDependencies)) console.log(`  ${k}: ${v}`);
  } else {
    writeFileSync(f, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(
      `[make-platform-packages] ${opts.optionalDeps}: version ${opts.version}, ${plan.length} optionalDependencies`
    );
  }
}
