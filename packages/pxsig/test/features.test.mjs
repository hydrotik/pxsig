// Workspace layers and provenance, mode inheritance, workspace-dependency staleness, the store lock,
// multi-project CLI reads, `approve plan --new`, `approve undo` from git, colocated .gitattributes,
// `doctor --fail-on info` and `check --since` rows. Temp folders only; no Storybook, no server.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readLog, record, snapshot, undo } from '../src/lib/approvals.mjs';
import { editedFilesSince, reconcile, resolveContext } from '../src/lib/integrity.mjs';
import { acquireLock, lockPath, readLock } from '../src/lib/lock.mjs';
import { ensureGitattributes, initProject } from '../src/lib/setup.mjs';
import { findWorkspace, loadProject, openProject, resolveModes } from '../src/lib/workspace.mjs';
import { CHECKER, fixture, hasRust, rustBin } from './fixture.mjs';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const env = {};
const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-feat-'));
  mkdirSync(join(root, '.git'));
  for (const [p, v] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v));
  }
  return root;
};
const node = (args, cwd, extra = {}) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, PXSIG_FORMAT: '', PXSIG_URL: 'http://127.0.0.1:1', PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '', PXSIG_PROJECT: '', ...extra } });
const cli = (args, cwd, extra) => node([join(src, 'cli.mjs'), ...args], cwd, extra);

// --- config layers -------------------------------------------------------------------------------------------

test('workspace defaults: paths resolve against the workspace root; provenance names each layer', () => {
  const root = tree({
    'pxsig.workspace.json': { projects: { ds: 'packages/ds' }, defaults: { storybook: { configDir: 'apps/sb/.storybook', staticDir: 'apps/sb/storybook-static' }, affects: { extra: ['shared/tokens'] }, grid: 48 } },
    'packages/ds/pxsig.config.json': { srcRoot: 'src', capture: { settleMs: 50 } },
  });
  const ws = findWorkspace({ cwd: root, env });
  const P = loadProject(ws, ws.projects[0], { env: { PXSIG_STORYBOOK_URL: 'http://127.0.0.1:9' }, flags: { grid: 32 } });
  assert.equal(P.storybook.configDir, join(root, 'apps', 'sb', '.storybook'), 'not relative to the project');
  assert.equal(P.storybook.staticDir, join(root, 'apps', 'sb', 'storybook-static'));
  assert.ok(P.affects.includes('shared/tokens'));
  assert.equal(P.srcRoot, join(root, 'packages', 'ds', 'src'), 'a project path stays relative to the project');
  const s = P.configSources;
  assert.equal(s.grid, 'flags');
  assert.equal(s['storybook.url'], 'env');
  assert.equal(s['storybook.configDir'], 'workspace defaults');
  assert.equal(s['capture.settleMs'], 'project config');
  assert.equal(s['capture.target'], 'defaults');
  assert.equal(s.modes, 'defaults');
});

test('pxsig config shows the layer of every key, and config flags are the top layer', () => {
  const root = tree({ 'pxsig.config.json': { name: 'one', grid: 96 }, 'src/a.ts': '' });
  const c = JSON.parse(cli(['config', '--json', '--storybook-url', 'http://127.0.0.1:5', '--grid', '24'], root).stdout);
  assert.equal(c.config.grid, 24);
  assert.equal(c.sources.grid, 'flags');
  assert.equal(c.sources['storybook.url'], 'flags');
  assert.equal(c.storybook.url, 'http://127.0.0.1:5');
  const md = cli(['config', '--markdown'], root);
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /\| Key \| Value \| Set by \|/);
  assert.match(md.stdout, /\| grid \| 96 \| project config \|/);
});

test('modes extend through several levels; a cycle or an unknown parent is a setup error', () => {
  const m = resolveModes({ base: { colorScheme: 'dark', globals: 'theme:dark' }, brand: { extends: 'base', globals: 'theme:brand' }, mobile: { extends: 'brand', viewport: [390, 844] } });
  assert.deepEqual(m.mobile, { colorScheme: 'dark', globals: 'theme:brand', viewport: [390, 844] });
  assert.equal(m.brand.extends, undefined);
  assert.throws(() => resolveModes({ a: { extends: 'b' }, b: { extends: 'c' }, c: { extends: 'a' } }), /cycle: a → b → c → a/);
  assert.throws(() => resolveModes({ a: { extends: 'nope' } }), /"nope", which is not defined/);
  const root = tree({ 'pxsig.config.json': { modes: { light: {}, dark: { extends: 'light', colorScheme: 'dark' }, dim: { extends: 'dark', globals: 'x' } } } });
  assert.equal(openProject({ cwd: root, env }).modes.dim.colorScheme, 'dark');
});

test('staleness traces workspace dependencies: their source folders are source roots', () => {
  const root = tree({
    'pxsig.workspace.json': { projects: { ds: 'packages/ds' } },
    'packages/ds/pxsig.config.json': {},
    'packages/ds/package.json': { name: '@x/ds', dependencies: { '@x/tokens': 'workspace:*' } },
    'packages/ds/src/Button/Button.stories.tsx': 'export default {}',
    'packages/tokens/package.json': { name: '@x/tokens' },
    'packages/tokens/src/colors.ts': 'export const c = 1;',
  });
  mkdirSync(join(root, 'packages/ds/node_modules/@x'), { recursive: true });
  symlinkSync(join(root, 'packages/tokens'), join(root, 'packages/ds/node_modules/@x/tokens'));
  const P = openProject({ cwd: join(root, 'packages/ds'), env });
  assert.ok(P.affects.includes('packages/tokens/src'), P.affects.join(', '));
  const ctx = resolveContext(P);
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(root, 'packages/ds/src/Button/Button.stories.tsx'), old, old);
  const files = editedFilesSince(ctx, Date.now() - 30_000).map((f) => f.file);
  assert.deepEqual(files, ['packages/tokens/src/colors.ts'], 'an edit in a workspace dependency is traced');
});

// --- the store lock ------------------------------------------------------------------------------------------

test('store lock: one holder; a dead holder is stale and taken over', () => {
  const root = tree({ 'pxsig.config.json': {}, '.pxsig/manifest.json': { version: 2, stories: [{ id: 'a--b', sig: '.pxsig/baselines/a--b.psig' }] } });
  const P = openProject({ cwd: root, env });
  const l = acquireLock(P, { holder: 'test' });
  assert.equal(readLock(P).pid, process.pid);
  l.release();
  assert.equal(readLock(P), null);
  // A live process holds it: refused, naming the holder.
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)']);
  writeFileSync(lockPath(P), JSON.stringify({ pid: child.pid, startedAt: new Date(Date.now() + 5000).toISOString(), holder: 'check', command: 'pxsig check --full' }));
  try {
    assert.throws(() => acquireLock(P, { holder: 'test' }), /pxsig check --full.*holds the store/);
    const r = node([join(src, 'check.mjs'), '--changed', 'x.ts'], root);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /holds the store/);
  } finally {
    child.kill();
  }
  // Gone: stale, taken over.
  writeFileSync(lockPath(P), JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: new Date().toISOString(), holder: 'check' }));
  assert.equal(readLock(P).stale, true);
  acquireLock(P, { holder: 'test' }).release();
});

test('a full check against a project the server holds goes through its queue', { skip: !hasRust && 'Rust binary not built' }, async () => {
  const f = fixture();
  const ids = [f.ids.ok, f.ids.drift];
  const posted = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/__pxsig/check') {
        const b = JSON.parse(body);
        posted.push(b);
        const check = JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8'));
        for (const r of check.rows) if (b.ids.includes(r.id)) Object.assign(r, { pass: r.id !== f.ids.drift, reasons: r.id === f.ids.drift ? ['ssim 0.5 < min 0.99'] : [] });
        writeFileSync(join(f.px, 'reports', 'check.json'), JSON.stringify(check));
        res.writeHead(202).end(JSON.stringify({ queued: b.ids }));
      } else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ running: false, queued: 0 }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  writeFileSync(join(f.px, 'reports', '.lock'), JSON.stringify({ pid: process.pid, startedAt: new Date(Date.now() - 1000).toISOString(), holder: 'serve', url }));
  const out = await new Promise((ok) => {
    const p = spawn(process.execPath, [join(src, 'check.mjs'), '--only', ids.join(',')], { cwd: f.repo, env: { ...process.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
    let log = '';
    p.stdout.on('data', (d) => (log += d));
    p.stderr.on('data', (d) => (log += d));
    p.on('exit', (code) => ok({ code, log }));
  });
  srv.close();
  assert.equal(out.code, 1, out.log);
  assert.match(out.log, /holds this store: queueing 2 entries/);
  assert.deepEqual(posted[0].ids.sort(), [...ids].sort());
  assert.equal(posted[0].project, 'fixture');
  // --update never goes through the server: it refuses.
  const upd = node([join(src, 'check.mjs'), '--suite', 'x'], f.repo);
  assert.equal(upd.status, 2);
});

// --- CLI over several projects ----------------------------------------------------------------------------

function twoProjects() {
  const row = (id, pass) => ({ id, story: id, mode: 'default', pass, metrics: { ssim: pass ? 1 : 0.5 }, reasons: pass ? [] : ['gate'], checkedAt: new Date().toISOString() });
  const proj = (name, ids) => ({
    [`packages/${name}/pxsig.config.json`]: { storybook: { url: 'http://127.0.0.1:1' } },
    [`packages/${name}/.pxsig/manifest.json`]: { version: 2, stories: ids.map((id) => ({ id, story: id, sig: `packages/${name}/.pxsig/baselines/${id}.psig` })) },
    [`packages/${name}/.pxsig/reports/check.json`]: { generatedAt: new Date().toISOString(), summary: {}, rows: ids.map((id, i) => row(id, i === 0)) },
  });
  return tree({ 'pxsig.workspace.json': { projects: { ui: 'packages/ui', forms: 'packages/forms' } }, ...proj('ui', ['ui-button--a', 'ui-button--b']), ...proj('forms', ['forms-field--a']) });
}

test('read commands cover every project when none is chosen; rows carry the project', () => {
  const root = twoProjects();
  const r = cli(['list', 'all', '--json'], root);
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.deepEqual(d.projects.map((p) => p.project).sort(), ['forms', 'ui']);
  assert.equal(d.projects.find((p) => p.project === 'ui').total, 2);
  const md = cli(['list', '--markdown', 'all'], root);
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /\| Project \| State \| Entry \|/);
  assert.match(md.stdout, /\| ui \| .* \| ui-button--b /);
  assert.match(md.stdout, /\| forms \| /);
  // Inside one project's folder, only that project; --all widens it again.
  assert.equal(JSON.parse(cli(['list', 'all', '--json'], join(root, 'packages/ui')).stdout).total, 2);
  assert.equal(JSON.parse(cli(['list', 'all', '--all', '--json'], join(root, 'packages/ui')).stdout).projects.length, 2);
  // --workspace from anywhere.
  const away = cli(['status', '--json', '--workspace', root], tmpdir());
  assert.equal(away.status, 0, away.stderr);
  assert.equal(JSON.parse(away.stdout).projects.length, 2);
});

test('write commands refuse without a project; report errors exit 2', () => {
  const root = twoProjects();
  for (const args of [['check', 'ui-button--a'], ['approve', 'log'], ['manifest'], ['config']]) {
    const r = cli(args, root);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /choose it with --project|choose one with --project/);
  }
  assert.equal(cli(['report', '--project', 'nope'], root).status, 2);
});

// --- doctor --fail-on info, check --since rows -----------------------------------------------------------------

function cleanProject({ quiet = false } = {}) {
  const fake = (id) => {
    const header = Buffer.from(JSON.stringify({ format: 'psig', container: 1, entry: { id }, record: {}, encryption: 'none', sections: [{ name: 'sig', length: 0, sha256: '' }, { name: 'image', type: 'image/png', length: 0, sha256: '' }] }));
    const pre = Buffer.alloc(10);
    pre.write('PSIG', 0, 'latin1');
    pre.writeUInt16LE(1, 4);
    pre.writeUInt32LE(header.length, 6);
    return Buffer.concat([pre, header]);
  };
  const ids = ['c-a--one', 'c-a--two'];
  const now = new Date().toISOString();
  const rows = [
    { id: ids[0], story: ids[0], pass: true, metrics: { ssim: 0.995 }, reasons: [], checkedAt: now },
    quiet ? { id: ids[1], story: ids[1], skipped: true, pass: true, metrics: null, inherited: false, unaffected: true } : { id: ids[1], story: ids[1], pass: true, metrics: { ssim: 1 }, reasons: [], checkedAt: now },
  ];
  const root = tree({
    'pxsig.config.json': { name: 'clean', storybook: { url: 'http://127.0.0.1:1' } },
    'src/A/A.stories.tsx': "export default { title: 'C/A' };\nexport const One = {};\nexport const Two = {};\n",
    '.pxsig/manifest.json': { version: 2, stories: ids.map((id) => ({ id, story: id, sig: `.pxsig/baselines/A/${id}.psig`, importPath: 'src/A/A.stories.tsx' })) },
    '.pxsig/reports/check.json': { generatedAt: now, summary: {}, rows },
    ...Object.fromEntries(ids.map((id) => [`.pxsig/baselines/A/${id}.psig`, fake(id)])),
    ...Object.fromEntries(ids.map((id) => [`.pxsig/renders/latest/${id}.png`, CHECKER])),
  });
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(join(root, 'src/A/A.stories.tsx'), old, old);
  for (const id of ids) utimesSync(join(root, `.pxsig/renders/latest/${id}.png`), old, old);
  return root;
}

test('doctor --fail-on info passes ok / drift-only ledgers and fails on info findings', () => {
  const clean = cleanProject();
  const r = cli(['doctor', '--offline', '--fail-on', 'info', '--json'], clean);
  assert.equal(r.status, 0, r.stdout.slice(0, 2000) + r.stderr);
  assert.ok(JSON.parse(r.stdout).summary.byStatus.drift >= 1);
  const quiet = cleanProject({ quiet: true });
  assert.equal(cli(['doctor', '--offline', '--fail-on', 'info', '--json'], quiet).status, 1, 'skipped-unaffected is an info finding');
  assert.equal(cli(['doctor', '--offline', '--fail-on', 'warn', '--json'], quiet).status, 0, 'but not a warning');
});

test('check --changed records unaffected entries with a baseline as skipped-unaffected, not never-checked', { skip: !hasRust && 'Rust binary not built' }, async () => {
  const f = fixture();
  const r = node([join(src, 'check.mjs'), '--changed', 'src/elsewhere/Unrelated.ts'], f.repo);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = new Map(JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8')).rows.map((x) => [x.id, x]));
  assert.equal(rows.get(f.ids.never).unaffected, true);
  assert.equal(rows.get(f.ids.never).note, 'skipped-unaffected');
  assert.equal(rows.get(f.ids.ok).inherited, true, 'a previous verdict is still carried forward');
  assert.ok(!rows.get(f.ids.unbaselined).unaffected, 'no baseline: not ok-but-unverified');
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const never = led.entries.find((x) => x.id === f.ids.never);
  assert.ok(!never.issues.some((i) => i.code === 'never-checked'), JSON.stringify(never.issues));
  assert.ok(never.issues.some((i) => i.code === 'skipped-unaffected'));
  assert.ok(!existsSync(join(f.px, 'reports', '.lock')), 'the lock is released');
});

// --- approve plan --new ------------------------------------------------------------------------------------------

test('approve plan --new plans first baselines: blocked unless named or --first-baselines', () => {
  const f = fixture({ withSigs: false });
  const plan = (extra) => JSON.parse(cli(['approve', 'plan', '--new', '--reason', 'first renders of the new stories', '--json', ...extra], f.repo).stdout);
  const p1 = plan([]);
  const e1 = p1.entries.find((e) => e.id === f.ids.unbaselined);
  assert.equal(e1.status, 'blocked');
  assert.equal(e1.kind, 'shape');
  assert.match(e1.why, /first baseline.*--first-baselines/);
  assert.ok(!p1.entries.some((e) => e.id === f.ids.ok), 'only NEW entries');
  const e2 = plan(['--first-baselines']).entries.find((e) => e.id === f.ids.unbaselined);
  assert.equal(e2.status, 'ok');
  assert.equal(e2.first, true);
  assert.equal(e2.baseSha, null);
  const e3 = plan(['--allow-shape', f.ids.unbaselined]).entries.find((e) => e.id === f.ids.unbaselined);
  assert.equal(e3.status, 'ok');
  // apply stays a person's job
  assert.equal(cli(['approve', 'apply'], f.repo).status, 3);
});

// --- approve undo from git -------------------------------------------------------------------------------------

test('approve undo restores from git when the local snapshot is gone, only on a matching sha256', () => {
  const root = tree({ 'pxsig.config.json': { name: 'g' } });
  rmSync(join(root, '.git'), { recursive: true });
  const git = (...a) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  const P = openProject({ cwd: root, env });
  const ids = ['a-b--one', 'a-b--two', 'a-b--new'];
  const entries = ids.map((id) => ({ id, sig: `.pxsig/baselines/B/${id}.psig` }));
  const manifest = { stories: entries };
  const file = (id) => join(root, `.pxsig/baselines/B/${id}.psig`);
  mkdirSync(dirname(file(ids[0])), { recursive: true });
  writeFileSync(file(ids[0]), 'v1-one');
  writeFileSync(file(ids[1]), 'v1-two');
  git('add', '-A');
  git('commit', '-qm', 'v1');
  // A batch approves new bytes for all three (the third is a first baseline), then is committed.
  for (const e of entries) {
    const { before } = snapshot(P, e, 'b2');
    writeFileSync(file(e.id), `v2-${e.id}`);
    record(P, e, { batch: 'b2', via: 'test', before });
  }
  git('add', '-A');
  git('commit', '-qm', 'v2');
  // Another machine: no history/ folder. One log line's `before` does not match any commit.
  rmSync(P.store.history, { recursive: true, force: true });
  const log = readLog(P);
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  assert.equal(log[0].before, sha('v1-one'));
  assert.ok(log[0].gitHead, 'the git HEAD is logged');
  log[1].before = sha('never committed');
  writeFileSync(P.store.approvals, `${log.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const res = undo(P, manifest, 'b2');
  assert.equal(res.source, 'git');
  assert.deepEqual(res.restored, [ids[0]]);
  assert.equal(readFileSync(file(ids[0]), 'utf8'), 'v1-one');
  assert.deepEqual(res.refused.map((r) => r.id), [ids[1]]);
  assert.equal(readFileSync(file(ids[1]), 'utf8'), `v2-${ids[1]}`, 'a refused entry is left alone');
  assert.deepEqual(res.removed, [ids[2]], 'a first baseline is undone by moving it to trash/');
  assert.ok(!existsSync(file(ids[2])));
});

// --- colocated .gitattributes ----------------------------------------------------------------------------------

test('init with the colocated layout adds *.psig binary diff=psig to the root .gitattributes, once', () => {
  const root = tree({ 'pxsig.workspace.json': { version: 1, projects: {} }, '.gitattributes': '*.png binary', 'packages/forms/package.json': { name: 'forms' } });
  const wrote = initProject({ dir: join(root, 'packages/forms'), workspaceRoot: root, layout: 'colocated' });
  assert.ok(wrote.includes(join(root, '.gitattributes')));
  const text = readFileSync(join(root, '.gitattributes'), 'utf8');
  assert.match(text, /^\*\.png binary\n/);
  assert.match(text, /^\*\.psig binary diff=psig$/m);
  assert.equal(ensureGitattributes(root), null, 'idempotent');
  initProject({ dir: join(root, 'packages/forms'), workspaceRoot: root, layout: 'colocated' });
  assert.equal(readFileSync(join(root, '.gitattributes'), 'utf8').match(/\*\.psig/g).length, 1);
  assert.equal(JSON.parse(readFileSync(join(root, 'packages/forms/pxsig.config.json'), 'utf8')).store.layout, 'colocated');
  // The package layout leaves the root alone.
  const pkg = tree({ 'pxsig.workspace.json': { version: 1, projects: {} }, 'packages/ui/package.json': {} });
  initProject({ dir: join(pkg, 'packages/ui'), workspaceRoot: pkg });
  assert.ok(!existsSync(join(pkg, '.gitattributes')));
});

// --- storybook.staticDir -----------------------------------------------------------------------------------------

test('storybook.staticDir: when storybook.url does not answer, the build is served on a free port', async () => {
  const { ensureStorybook } = await import('../src/lib/static.mjs');
  const index = { v: 5, entries: { 'a--b': { type: 'story', id: 'a--b', title: 'A', name: 'B', importPath: './src/A.stories.tsx' } } };
  const root = tree({ 'pxsig.config.json': { storybook: { url: 'http://127.0.0.1:1', staticDir: 'sb-static' } }, 'sb-static/index.json': index, 'sb-static/iframe.html': '<html></html>' });
  const P = openProject({ cwd: root, env });
  const sb = await ensureStorybook(P);
  try {
    assert.equal(sb.served, true);
    assert.equal(P.storybook.url, sb.url);
    assert.equal(sb.index.healthy, true);
    assert.deepEqual(sb.index.stories.map((s) => s.id), ['a--b']);
    assert.equal((await fetch(`${sb.url}/iframe.html`)).status, 200);
    assert.equal((await fetch(`${sb.url}/../pxsig.config.json`)).status, 404);
  } finally {
    await sb.close();
  }
  // No build in the folder: nothing served, the caller reports Storybook unreachable.
  const empty = tree({ 'pxsig.config.json': { storybook: { url: 'http://127.0.0.1:1', staticDir: 'nothing' } } });
  assert.equal((await ensureStorybook(openProject({ cwd: empty, env }))).served, false);
});

test('one version: the npm package, the MCP server and the Rust workspace agree', () => {
  const cargo = readFileSync(new URL('../../../Cargo.toml', import.meta.url), 'utf8').match(/\[workspace\.package\][^[]*?version\s*=\s*"([^"]+)"/)[1];
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.equal(pkg, cargo);
  if (hasRust) assert.equal(spawnSync(rustBin, ['--version'], { encoding: 'utf8' }).stdout.trim(), `pxsig ${cargo}`);
});
