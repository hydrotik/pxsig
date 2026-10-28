#!/usr/bin/env node
/**
 * install-smoke.mjs — pxsig installed the way a user installs it: from the packed tarballs, with
 * the engine coming from the platform package and no PXSIG_BIN.
 *
 *   node scripts/install-smoke.mjs [--engine <pxsig binary>] [--keep]
 *
 * 1. The release's own scripts build what it ships, for this machine only: make-platform-packages
 *    (`@pxsig/cli-<platform>-<arch>`, version 0.0.0-ci, from the engine), sync-dashboard-source,
 *    pack-manifest, then `npm pack --ignore-scripts` (release.yml, pack job). The pxsig package is
 *    packed from a copy, so the two package.json edits the release makes in its checkout never
 *    touch this one.
 * 2. In an empty folder whose path has a space: `npm install <pxsig.tgz> <cli-*.tgz>` (Playwright
 *    at the version this checkout tests with, so the installed Chromium matches), then
 *    `npm exec -- pxsig --version`: the CLI is 0.0.0-ci and its engine resolves.
 * 3. `PXSIG_DEBUG=spawn npm exec -- pxsig doctor --ci` on a one-story project: every `[spawn]` line
 *    names node, git or the engine in that platform package, and the engine is among them.
 *
 * --engine defaults to target/release/pxsig[.exe] (where CI downloads the build). --keep leaves
 * the temp folder. Needs npm (found next to this Node, never through a shell) and network access
 * for the install. Exit 1 on a failure, 2 on a usage error.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

/** @import { SpawnSyncReturns } from 'node:child_process' */
/** @typedef {{ cwd?: string, env?: NodeJS.ProcessEnv, must?: boolean }} RunOpts */

const repo = fileURLToPath(new URL('..', import.meta.url));
const id = `${process.platform}-${process.arch}`;
const exe = process.platform === 'win32' ? 'pxsig.exe' : 'pxsig';
const VERSION = '0.0.0-ci';

/** @param {string} m */
const log = (m) => console.log(`[install-smoke] ${m}`);
/**
 * @param {string} m
 * @returns {never}
 */
function fail(m) {
  console.error(`[install-smoke] FAIL ${m}`);
  process.exit(1);
}

let engine = join(repo, 'target', 'release', exe);
let keep = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--keep') keep = true;
  else if (argv[i] === '--engine' && argv[i + 1]) engine = resolve(argv[++i]);
  else {
    console.error(
      `[install-smoke] unknown argument: ${argv[i]}\nusage: node scripts/install-smoke.mjs [--engine <pxsig binary>] [--keep]`
    );
    process.exit(2);
  }
}
if (!existsSync(engine)) fail(`no engine at ${engine} (cargo build --release, or --engine)`);

/**
 * npm's own entry point, run with this Node: `npm` is a .cmd shim on Windows, which Node starts
 * only through a shell, and the smoke starts none of its own.
 * @returns {string}
 */
function npmCli() {
  const here = dirname(process.execPath);
  const found = [
    process.env.npm_execpath,
    join(here, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows
    join(here, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // macOS, Linux
  ].find((f) => f && basename(f) === 'npm-cli.js' && existsSync(f));
  return found ?? fail(`npm-cli.js not found next to ${process.execPath}`);
}
const npm = npmCli();

/**
 * Run a program without a shell; fail on a non-zero exit unless `must` is false.
 * @param {string} cmd
 * @param {string[]} args
 * @param {RunOpts} [opts]
 * @returns {SpawnSyncReturns<string>}
 */
function run(cmd, args, { cwd = repo, env = process.env, must = true } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) fail(`${cmd} ${args.join(' ')}: ${r.error.message}`);
  if (must && r.status !== 0)
    fail(`${basename(cmd)} ${args.join(' ')} → exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r;
}
/**
 * @param {string[]} args
 * @param {RunOpts} [opts]
 */
const runNpm = (args, opts) => run(process.execPath, [npm, ...args], opts);
/**
 * @param {string} script
 * @param {string[]} args
 * @param {RunOpts} [opts]
 */
const runScript = (script, args, opts) =>
  run(process.execPath, [join(repo, 'scripts', script), ...args], opts);

// On the runner's work drive on Windows (as examples-test.mjs), with a space in every path below.
const tmp = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'pxsig smoke-'));
log(`${id}, engine ${engine}, in ${tmp}`);
try {
  // --- 1. Build and pack, as the release does --------------------------------------------------
  const artifacts = join(tmp, 'artifacts');
  mkdirSync(join(artifacts, `pxsig-${id}`), { recursive: true });
  copyFileSync(engine, join(artifacts, `pxsig-${id}`, exe));
  const stage = join(tmp, 'stage');
  runScript('sync-dashboard-source.mjs', []);
  cpSync(join(repo, 'packages', 'pxsig'), join(stage, 'pxsig'), {
    recursive: true,
    filter: (p) => !p.split(/[\\/]/).includes('node_modules'),
  });
  runScript('make-platform-packages.mjs', [
    '--version',
    VERSION,
    '--artifacts',
    artifacts,
    '--out',
    join(stage, 'cli-dist'),
    '--only',
    id,
    '--write-optional-deps',
    join(stage, 'pxsig', 'package.json'),
  ]);
  runScript('pack-manifest.mjs', [join(stage, 'pxsig')]);
  const packed = join(tmp, 'packed');
  mkdirSync(packed);
  for (const dir of [join(stage, 'cli-dist', `cli-${id}`), join(stage, 'pxsig')])
    runNpm(['pack', '--ignore-scripts', '--pack-destination', packed], { cwd: dir });
  const tarballs = readdirSync(packed).filter((f) => f.endsWith('.tgz'));
  const expected = [`pxsig-${VERSION}.tgz`, `pxsig-cli-${id}-${VERSION}.tgz`];
  for (const f of expected)
    if (!tarballs.includes(f)) fail(`npm pack did not write ${f} (wrote ${tarballs.join(', ')})`);
  // Relative names: GNU tar (Git for Windows) reads "C:\…" as a remote host.
  runScript('pack-manifest.mjs', ['--check', ...expected], { cwd: packed });
  log(`packed ${expected.join(', ')}`);

  // --- 2. Install into an empty project ----------------------------------------------------------
  const project = join(tmp, 'my project');
  mkdirSync(project);
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify({ name: 'pxsig-smoke', private: true, version: '1.0.0' }, null, 2)}\n`
  );
  // A peer dependency: pinned to the version this checkout tests with (its Chromium is installed).
  const playwright = /** @type {{ version: string }} */ (
    JSON.parse(
      readFileSync(
        createRequire(join(repo, 'packages', 'pxsig', 'package.json')).resolve(
          'playwright/package.json'
        ),
        'utf8'
      )
    )
  ).version;
  runNpm(
    [
      'install',
      '--no-audit',
      '--no-fund',
      ...expected.map((f) => join(packed, f)),
      `playwright@${playwright}`,
    ],
    { cwd: project }
  );
  const installed = join(project, 'node_modules', '@pxsig', `cli-${id}`, 'bin', exe);
  if (!existsSync(installed)) fail(`the platform package's engine is not at ${installed}`);
  log(`installed; engine at ${installed}`);

  // pxsig's runs: no PXSIG_BIN, and the machine's state folders in the temp folder. Playwright
  // finds its browsers under the same folders, so its own path stays where they are.
  const state = join(tmp, 'state');
  mkdirSync(state);
  const browsers =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
        : join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright'));
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    CI: '1',
    PXSIG_FORMAT: 'plain',
    PLAYWRIGHT_BROWSERS_PATH: browsers,
  };
  for (const k of ['PXSIG_BIN', 'PXSIG_NO_DELEGATE', 'PXSIG_DEBUG', 'PXSIG_PLAYWRIGHT'])
    delete env[k];
  Object.assign(env, {
    HOME: state,
    USERPROFILE: state,
    XDG_STATE_HOME: state,
    LOCALAPPDATA: state,
  });
  // `npm exec` runs the bin shim with the `node` on PATH: this one.
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = [dirname(process.execPath), env[pathKey]]
    .filter(Boolean)
    .join(process.platform === 'win32' ? ';' : ':');

  const v = runNpm(['exec', '--offline', '--', 'pxsig', '--version', '--json'], {
    cwd: project,
    env,
  });
  /** @type {{ pxsig?: string, engine?: string | null }} */
  let versions = {};
  try {
    // `pxsig --version --json`'s answer (cli.mjs).
    versions = /** @type {typeof versions} */ (JSON.parse(v.stdout.trim().split('\n').pop() ?? ''));
  } catch {
    fail(`pxsig --version --json printed no JSON:\n${v.stdout}\n${v.stderr}`);
  }
  if (versions.pxsig !== VERSION) fail(`pxsig --version: ${versions.pxsig}, expected ${VERSION}`);
  if (!versions.engine) fail(`pxsig --version: no engine resolved without PXSIG_BIN\n${v.stdout}`);
  log(`pxsig --version: pxsig ${versions.pxsig}, engine ${versions.engine}`);

  // --- 3. doctor on a one-story project, every program it starts listed ------------------------
  const storyId = 'components-alpha--default';
  /**
   * @param {string} rel
   * @param {string | Buffer} data
   */
  const put = (rel, data) => {
    const f = join(project, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, data);
  };
  put(
    'pxsig.config.json',
    JSON.stringify({
      version: 1,
      name: 'smoke',
      srcRoot: 'src',
      storybook: { url: 'http://127.0.0.1:1' },
      modes: { dark: { globals: 'theme:dark', colorScheme: 'dark' } },
    })
  );
  put(
    'src/components/Alpha/Alpha.stories.tsx',
    "export default { title: 'Components/Alpha' };\nexport const Default = {};\n"
  );
  const sig = `.pxsig/baselines/components/Alpha/${storyId}.psig`;
  put(
    '.pxsig/manifest.json',
    JSON.stringify({
      version: 2,
      project: 'smoke',
      skipped: [],
      stories: [
        {
          id: storyId,
          story: storyId,
          mode: 'dark',
          state: null,
          sig,
          importPath: 'src/components/Alpha/Alpha.stories.tsx',
          globals: 'theme:dark',
          colorScheme: 'dark',
          viewport: [900, 600],
          browser: 'chromium',
          a11y: false,
        },
      ],
    })
  );
  // The render, and its baseline packed by the installed engine.
  const png = join(project, '.pxsig', 'renders', 'latest', `${storyId}.png`);
  mkdirSync(dirname(png), { recursive: true });
  writeFileSync(png, checker(64));
  const json = join(tmp, `${storyId}.pxsig.json`);
  run(installed, ['capture', png, '--out', json, '--grid', '16']);
  mkdirSync(dirname(join(project, sig)), { recursive: true });
  run(installed, [
    'pack',
    json,
    '--out',
    join(project, sig),
    '--entry',
    JSON.stringify({ id: storyId }),
    '--image',
    png,
  ]);
  run('git', ['init', '-q'], { cwd: project });

  const d = runNpm(['exec', '--offline', '--', 'pxsig', 'doctor', '--ci'], {
    cwd: project,
    env: { ...env, PXSIG_DEBUG: 'spawn' },
    must: false,
  });
  if (d.status !== 0 && d.status !== 1)
    fail(`pxsig doctor --ci → exit ${d.status}\n${d.stdout}\n${d.stderr}`);
  const lines = d.stderr
    .split(/\r?\n/)
    .filter((l) => l.startsWith('[spawn] '))
    .map((l) => l.slice('[spawn] '.length));
  const enginePaths = [installed, realpathSync(installed)];
  /** @param {string} line */
  const program = (line) => {
    // Windows paths compare without case.
    const fold = (/** @type {string} */ t) => (process.platform === 'win32' ? t.toLowerCase() : t);
    const e = enginePaths.find(
      (p) => fold(line) === fold(p) || fold(line).startsWith(fold(`${p} `))
    );
    if (e) return 'engine';
    const first = line.split(' ')[0];
    if (first === 'git') return 'git';
    if (/^node(\.exe)?$/i.test(first.split(/[\\/]/).pop() ?? '')) return 'node';
    return null;
  };
  log(`doctor --ci → exit ${d.status}; programs started:`);
  for (const l of lines) console.log(`  ${program(l) ?? 'NOT ALLOWED'}: ${l}`);
  const others = lines.filter((l) => !program(l));
  if (others.length)
    fail(`pxsig started a program outside node, git and the engine:\n  ${others.join('\n  ')}`);
  if (!lines.some((l) => program(l) === 'engine'))
    fail(`doctor started no engine from ${installed.split(sep).slice(-5).join('/')}\n${d.stderr}`);
  log('ok');
} finally {
  if (keep) log(`kept ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
}

/**
 * A size×size RGBA PNG checkerboard, written without dependencies.
 * @param {number} size
 * @returns {Buffer}
 */
function checker(size) {
  /** @type {number[]} */
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  /** @param {Buffer} buf */
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  /**
   * @param {string} type
   * @param {Buffer} data
   */
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const row = size * 4 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = ((x >> 3) + (y >> 3)) % 2 ? 230 : 40;
      raw.set([v, v, v, 255], y * row + 1 + x * 4);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
