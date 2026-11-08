#!/usr/bin/env node
/**
 * compat-old.mjs — what a teammate still on an older pxsig sees in a store this one wrote
 * (`requires`: docs/configuration.md#pxsigworkspacejson). It installs the published pxsig given
 * (default 0.3.2) into a temporary folder, writes a store with this checkout (approval lines with
 * `pxsig`, no `by`, no `reason`), and runs the old `approve verify` and `status` against it.
 *
 *   node scripts/compat-old.mjs [version]
 *
 * Asserted, as observed for 0.3.2: both run, verify finds every baseline matching its line, status
 * reads the store (whose report carries render environments), the old engine reads a baseline whose
 * header records one (`env`, 0.5) and a text record after its image (a `boxes` section, 0.7.6); a
 * workspace `requires: ">=0.4.0"` does not stop it (it predates the key). Needs npm, network access
 * to the registry, and this checkout's Rust binary.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

/** @import { ApprovalLine, CheckRow, CheckSummary, Project } from '../packages/pxsig/src/types.js' */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const version = process.argv[2] ?? '0.3.2';
/** @type {(m: string) => never} */
const fail = (m) => (console.error(`[compat] FAIL ${m}`), process.exit(1));
const ok = (/** @type {string} */ m) => console.log(`  ok   ${m}`);

const { fixture } = /** @type {typeof import('../packages/pxsig/test/fixture.mjs')} */ (
  await import(pathToFileURL(join(repoRoot, 'packages/pxsig/test/fixture.mjs')).href)
);
// `record`'s options, as approvals.mjs reads them (its own JSDoc does not give them yet).
const { record } =
  /** @type {{ record: (P: Project, entry: { id: string, sig: string }, opts: { batch: string, via: string, before: string | null }) => ApprovalLine }} */ (
    await import(pathToFileURL(join(repoRoot, 'packages/pxsig/src/lib/approvals.mjs')).href)
  );
const { openProject, PXSIG_VERSION, writeRunManifest } =
  /** @type {typeof import('../packages/pxsig/src/lib/workspace.mjs')} */ (
    await import(pathToFileURL(join(repoRoot, 'packages/pxsig/src/lib/workspace.mjs')).href)
  );
const { readHeader } = /** @type {typeof import('../packages/pxsig/src/lib/psig.mjs')} */ (
  await import(pathToFileURL(join(repoRoot, 'packages/pxsig/src/lib/psig.mjs')).href)
);

// A store as this pxsig writes it: baselines that record their render environment, every baseline
// logged by this version, and a report with `envs` and per-row env fields.
const f = fixture();
const P = openProject({ cwd: f.repo });
const env = {
  v: 1,
  id: '0123456789abcdef',
  browser: { name: 'chromium', version: '141.0.7390.37', channel: null, launchArgs: [] },
  os: { platform: 'linux', arch: 'x64' },
  fonts: { probe: { digest: 'x', families: {} } },
  render: { dpr: 1 },
  capture: { pipeline: 1 },
};
const plan = join(f.repo, '.env-plan.json');
const withEnv = [f.ids.ok, f.ids.drift];
writeFileSync(
  plan,
  JSON.stringify({
    envs: { [env.id]: env },
    byId: Object.fromEntries(withEnv.map((id) => [id, env.id])),
  })
);
const b = spawnSync(
  P.rustBin,
  [
    'baseline',
    '--manifest',
    writeRunManifest(P).path,
    '--png-dir',
    P.store.latest,
    '--root',
    P.workspaceRoot,
    '--only',
    withEnv.join(','),
    '--env',
    `@${plan}`,
    '--json',
  ],
  { encoding: 'utf8' }
);
if (b.status !== 0 || readHeader(f.sig(f.ids.ok))?.env?.id !== env.id)
  fail(`baselines with env were not written: ${b.stderr}`);
// check.json, as this checkout's pxsig wrote it.
const report =
  /** @type {{ envs?: Record<string, unknown>, rows: CheckRow[], summary: CheckSummary & { envMismatch?: number } }} */ (
    JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8'))
  );
report.envs = { [env.id]: env };
report.rows = report.rows.map((r) =>
  withEnv.includes(r.id)
    ? { ...r, env: env.id, baselineEnv: env.id, envMatch: /** @type {const} */ ('same') }
    : r
);
report.summary = { ...report.summary, envMismatch: 0 };
writeFileSync(join(f.px, 'reports', 'check.json'), JSON.stringify(report));
ok(`${withEnv.length} baselines record a render environment (env), and the report carries envs`);

// A text record, as approval writes it from 0.7.6: a deflated `boxes` section after the image
// (docs/spec.md section 5), appended here since no command writes one yet. This checkout's engine
// reads it back; the old one must skip it (below).
const withBoxes = f.sig(f.ids.ok);
{
  const buf = readFileSync(withBoxes);
  const len = buf.readUInt32LE(6);
  // The header this checkout's engine just wrote (docs/spec.md section 5).
  const head = /** @type {{ sections: object[] }} */ (
    JSON.parse(buf.subarray(10, 10 + len).toString('utf8'))
  );
  const body = deflateRawSync(JSON.stringify({ v: 1, runs: [{ s: '1 ' }, { s: 'new' }] }));
  const sha256 = createHash('sha256').update(body).digest('hex');
  const boxes = { name: 'boxes', type: 'application/json', encoding: 'deflate' };
  head.sections.push({ ...boxes, length: body.length, sha256, runs: 2 });
  const text = Buffer.from(`${JSON.stringify(head, null, 2)}\n`);
  const pre = Buffer.from(buf.subarray(0, 10));
  pre.writeUInt32LE(text.length, 6);
  writeFileSync(withBoxes, Buffer.concat([pre, text, buf.subarray(10 + len), body]));
}
const cat = spawnSync(P.rustBin, ['cat', withBoxes], { encoding: 'utf8' });
if (cat.status !== 0 || !cat.stdout.includes('--- boxes: 2 runs\n"1 "\n"new"'))
  fail(
    `this engine does not read the boxes section: exit ${cat.status}\n${cat.stdout}${cat.stderr}`
  );
ok('a baseline carries a text record (boxes, deflated), and this engine prints its strings');
for (const e of f.manifest.stories.filter((x) => !x.sig.endsWith('.pxsig.json')))
  record(P, e, { batch: 'compat', via: 'cli', before: null });
const lines = readFileSync(join(f.px, 'approvals.ndjson'), 'utf8')
  .trim()
  .split('\n')
  // approvals.ndjson, as `record` just wrote it.
  .map((l) => /** @type {ApprovalLine} */ (JSON.parse(l)));
if (!lines.every((l) => l.pxsig === PXSIG_VERSION && !('by' in l) && !('reason' in l)))
  fail('this pxsig wrote lines without its version, or with `by` or `reason`');
ok(`${lines.length} approval lines written by pxsig ${PXSIG_VERSION} (no by, no reason)`);

// The old pxsig, as a teammate has it.
const old = mkdtempSync(join(tmpdir(), `pxsig-${version}-`));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const inst = spawnSync(
  npm,
  ['install', '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', `pxsig@${version}`],
  { cwd: old, encoding: 'utf8', shell: process.platform === 'win32' }
);
if (inst.status !== 0) fail(`npm install pxsig@${version}: ${inst.stderr}`);
const run = (/** @type {string[]} */ args) =>
  spawnSync(
    process.execPath,
    [join(old, 'node_modules', 'pxsig', 'bin', 'pxsig.mjs'), ...args, '--json'],
    {
      cwd: f.repo,
      encoding: 'utf8',
      env: { ...process.env, PXSIG_WORKSPACE: '', PXSIG_NO_DELEGATE: '1', PXSIG_BIN: '' },
    }
  );

let r = run(['approve', 'verify']);
/** @type {{ mismatched?: unknown[], logged?: number }} */
let v;
try {
  // `approve verify --json`'s answer (the old pxsig's: these are the keys read).
  v = /** @type {{ mismatched?: unknown[], logged?: number }} */ (JSON.parse(r.stdout));
} catch {
  fail(
    `pxsig ${version} approve verify printed no JSON (exit ${r.status}):\n${r.stdout}${r.stderr}`
  );
}
if (r.status !== 0 || v.mismatched?.length)
  fail(`pxsig ${version} approve verify: exit ${r.status}, ${v.mismatched?.length} mismatched`);
ok(
  `pxsig ${version} approve verify reads the new lines: exit 0, ${v.logged} logged, none mismatched`
);

r = run(['status']);
try {
  JSON.parse(r.stdout);
} catch {
  fail(`pxsig ${version} status printed no JSON (exit ${r.status}):\n${r.stdout}${r.stderr}`);
}
ok(`pxsig ${version} status reads the store (exit ${r.status})`);

// The old engine reads a header with `env` (an unknown top-level key) and its signature as before.
const oldBin = join(
  old,
  'node_modules',
  '@pxsig',
  `cli-${process.platform}-${process.arch}`,
  'bin',
  process.platform === 'win32' ? 'pxsig.exe' : 'pxsig'
);
if (existsSync(oldBin)) {
  r = spawnSync(oldBin, ['cat', f.sig(f.ids.ok)], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.includes('"record"') || !r.stdout.includes('"boxes"'))
    fail(
      `pxsig ${version}'s engine could not read a baseline with env and boxes: exit ${r.status}\n${r.stderr}`
    );
  ok(
    `pxsig ${version}'s engine reads a baseline whose header records env and a boxes section (cat: exit 0)`
  );
} else
  ok(
    `pxsig ${version}'s engine for ${process.platform}-${process.arch} is not installed here: skipped the header read`
  );

// `requires` cannot hold an older pxsig back: it predates the key.
writeFileSync(
  join(f.repo, 'pxsig.workspace.json'),
  JSON.stringify(
    { version: 1, requires: `>=${PXSIG_VERSION}`, projects: { fixture: '.' } },
    null,
    2
  )
);
r = run(['approve', 'verify']);
if (r.status !== 0) fail(`pxsig ${version} with requires: exit ${r.status}\n${r.stderr}`);
ok(
  `pxsig ${version} ignores requires ">=${PXSIG_VERSION}" (documented: only 0.4.0 and later read it)`
);
console.log('[compat] all passed');
