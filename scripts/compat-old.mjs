#!/usr/bin/env node
/**
 * compat-old.mjs — what a teammate still on an older pxsig sees in a store this one wrote
 * (decision 92). It installs the published pxsig given (default 0.3.2) into a temporary folder,
 * writes a store with this checkout (approval lines with `pxsig`, no `by`), and runs the old
 * `approve verify` and `status` against it.
 *
 *   node scripts/compat-old.mjs [version]
 *
 * Asserted, as observed for 0.3.2: both run, verify finds every baseline matching its line, status
 * reads the store; a workspace `requires: ">=0.4.0"` does not stop it (it predates the key). Needs
 * npm, network access to the registry, and this checkout's Rust binary.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const version = process.argv[2] ?? '0.3.2';
const fail = (m) => (console.error(`[compat] FAIL ${m}`), process.exit(1));
const ok = (m) => console.log(`  ok   ${m}`);

const { fixture } = await import(pathToFileURL(join(repoRoot, 'packages/pxsig/test/fixture.mjs')).href);
const { record } = await import(pathToFileURL(join(repoRoot, 'packages/pxsig/src/lib/approvals.mjs')).href);
const { openProject, PXSIG_VERSION } = await import(pathToFileURL(join(repoRoot, 'packages/pxsig/src/lib/workspace.mjs')).href);

// A store as this pxsig writes it: every baseline logged by this version.
const f = fixture();
const P = openProject({ cwd: f.repo });
for (const e of f.manifest.stories.filter((x) => !x.sig.endsWith('.pxsig.json'))) record(P, e, { batch: 'compat', via: 'cli', before: null });
const lines = readFileSync(join(f.px, 'approvals.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
if (!lines.every((l) => l.pxsig === PXSIG_VERSION && !('by' in l))) fail('this pxsig wrote lines without its version, or with `by`');
ok(`${lines.length} approval lines written by pxsig ${PXSIG_VERSION} (no by)`);

// The old pxsig, as a teammate has it.
const old = mkdtempSync(join(tmpdir(), `pxsig-${version}-`));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const inst = spawnSync(npm, ['install', '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', `pxsig@${version}`], { cwd: old, encoding: 'utf8', shell: process.platform === 'win32' });
if (inst.status !== 0) fail(`npm install pxsig@${version}: ${inst.stderr}`);
const run = (args) => spawnSync(process.execPath, [join(old, 'node_modules', 'pxsig', 'bin', 'pxsig.mjs'), ...args, '--json'], { cwd: f.repo, encoding: 'utf8', env: { ...process.env, PXSIG_WORKSPACE: '', PXSIG_NO_DELEGATE: '1', PXSIG_BIN: '' } });

let r = run(['approve', 'verify']);
let v;
try {
  v = JSON.parse(r.stdout);
} catch {
  fail(`pxsig ${version} approve verify printed no JSON (exit ${r.status}):\n${r.stdout}${r.stderr}`);
}
if (r.status !== 0 || v.mismatched?.length) fail(`pxsig ${version} approve verify: exit ${r.status}, ${v.mismatched?.length} mismatched`);
ok(`pxsig ${version} approve verify reads the new lines: exit 0, ${v.logged} logged, none mismatched`);

r = run(['status']);
try {
  JSON.parse(r.stdout);
} catch {
  fail(`pxsig ${version} status printed no JSON (exit ${r.status}):\n${r.stdout}${r.stderr}`);
}
ok(`pxsig ${version} status reads the store (exit ${r.status})`);

// `requires` cannot hold an older pxsig back: it predates the key.
writeFileSync(join(f.repo, 'pxsig.workspace.json'), JSON.stringify({ version: 1, requires: `>=${PXSIG_VERSION}`, projects: { fixture: '.' } }, null, 2));
r = run(['approve', 'verify']);
if (r.status !== 0) fail(`pxsig ${version} with requires: exit ${r.status}\n${r.stderr}`);
ok(`pxsig ${version} ignores requires ">=${PXSIG_VERSION}" (documented: only 0.4.0 and later read it)`);
console.log('[compat] all passed');
