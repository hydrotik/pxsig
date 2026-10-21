#!/usr/bin/env node
/**
 * examples-test.mjs — pxsig end to end on the example projects, from a clean copy.
 *
 *   node scripts/examples-test.mjs [single-package|monorepo|custom-ui]   (default: all)
 *
 * For each example: copy it to a temp folder (pointing its `link:` dependencies at this checkout),
 * install, build and serve its Storybook, then:
 *   1. manifest      every story × mode × state, for every project
 *   2. check         every entry is NEW (no baseline): exit 1
 *   3. baseline      the first renders become baselines (what approving them does)
 *   4. check         everything passes: exit 0; again with a dead storybook.url and
 *                    --storybook-static: the check serves the build itself
 *   5. change        a component's colour changes; the check fails on exactly its entries
 *   6. doctor --ci   no error-severity integrity codes
 * And custom-ui (no Storybook): `pxsig dashboard gaps` reports the plain adapter's gaps, and
 * `pxsig dashboard build` rebuilds the dashboard on it from the installed pxsig.
 * Needs pnpm, network access for the installs, Playwright's Chromium, and the Rust binary
 * (`cargo build --release`, or PXSIG_BIN).
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const cli = join(repo, 'packages', 'pxsig', 'bin', 'pxsig.mjs');
const bin = process.env.PXSIG_BIN ?? join(repo, 'target', 'release', process.platform === 'win32' ? 'pxsig.exe' : 'pxsig');
if (!existsSync(bin)) throw new Error(`build the Rust binary first: cargo build --release (looked for ${bin})`);
const which = process.argv[2];

const log = (m) => console.log(`[examples] ${m}`);
let failures = 0;
const expect = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const env = { ...process.env, PXSIG_BIN: bin, PXSIG_FORMAT: 'plain', PXSIG_NO_DELEGATE: '1', CI: '1' };
const sh = (cmd, args, cwd, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (opts.must !== false && r.status !== 0 && !opts.allow?.includes(r.status)) throw new Error(`${cmd} ${args.join(' ')} → ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r;
};
const pxsig = (args, cwd) => sh(process.execPath, [cli, ...args], cwd, { must: false });

/** Copy an example, rewriting `link:` dependencies to this checkout's packages. */
function stage(name) {
  const dir = mkdtempSync(join(tmpdir(), `pxsig-example-${name}-`));
  cpSync(join(repo, 'examples', name), dir, { recursive: true, filter: (p) => !/node_modules|storybook-static|\.pxsig|__pxsig__/.test(p) });
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory() && e.name !== 'node_modules') walk(p);
      else if (e.name === 'package.json') {
        const pj = JSON.parse(readFileSync(p, 'utf8'));
        for (const k of ['dependencies', 'devDependencies'])
          for (const [dep, v] of Object.entries(pj[k] ?? {}))
            if (String(v).startsWith('link:')) pj[k][dep] = `link:${join(repo, 'packages', dep === 'pxsig' ? 'pxsig' : dep.replace('@pxsig/', ''))}`;
        writeFileSync(p, JSON.stringify(pj, null, 2));
      }
    }
  };
  walk(dir);
  return dir;
}

/**
 * Serve a storybook-static folder on a free port, in a child process (this script blocks on
 * spawnSync while pxsig renders, so an in-process server could not answer).
 */
function serveStatic(root) {
  const code = `
    const http = require('http'), fs = require('fs'), path = require('path');
    const root = ${JSON.stringify(resolve(root))};
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    const s = http.createServer((req, res) => {
      let f = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!f.startsWith(root)) return res.writeHead(403).end();
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((ok) => child.stdout.once('data', (d) => ok({ port: Number(String(d).trim()), close: () => child.kill() })));
}

/** Write baselines from the latest renders: what approving every NEW entry does. */
function baselineAll(dir, project) {
  const code = `
    const { openProject, writeRunManifest } = await import(${JSON.stringify(join(repo, 'packages/pxsig/src/lib/workspace.mjs'))});
    const P = openProject({ project: ${JSON.stringify(project)} });
    const run = writeRunManifest(P).path;
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(P.rustBin, ['baseline', '--manifest', run, '--png-dir', P.store.latest, '--root', P.workspaceRoot, '--json'], { encoding: 'utf8' });
    process.stdout.write(r.stdout); process.exit(r.status);`;
  return JSON.parse(sh(process.execPath, ['--input-type=module', '-e', code], dir).stdout);
}

const checkJson = (dir, project) => JSON.parse(readFileSync(join(dir, ...projectStore(dir, project), 'reports', 'check.json'), 'utf8'));
function projectStore(dir, project) {
  const ws = existsSync(join(dir, 'pxsig.workspace.json')) ? JSON.parse(readFileSync(join(dir, 'pxsig.workspace.json'), 'utf8')) : null;
  return ws ? [ws.projects[project], '.pxsig'] : ['.pxsig'];
}

async function run(name, { projects, storybookDir, change }) {
  log(`${name}: staging`);
  const dir = stage(name);
  log(`${name}: pnpm install in ${dir}`);
  sh('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile', '--config.confirmModulesPurge=false'], dir, { stdio: 'inherit' });
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) sh('pnpm', ['install', '--no-frozen-lockfile'], dir, { stdio: 'inherit' });
  const build = () => sh('pnpm', ['build-storybook'], dir, { stdio: 'inherit' });
  build();
  const server = await serveStatic(join(dir, storybookDir, 'storybook-static'));
  // The configured port may be in use on this machine: point every project at this server.
  env.PXSIG_STORYBOOK_URL = `http://127.0.0.1:${server.port}`;
  try {
    for (const p of projects) {
      log(`${name}/${p}: manifest`);
      let r = pxsig(['manifest', '--project', p], dir);
      expect(r.status === 0, `manifest (${r.stdout.match(/Entries[^\n]*/)?.[0] ?? r.stderr.trim()})`);
      r = pxsig(['check', '--full', '--project', p, '--retries', '0'], dir);
      const first = checkJson(dir, p);
      expect(r.status === 1 && first.rows.every((x) => !x.pass), `first check: every entry is NEW (${first.rows.length})`);
      const b = baselineAll(dir, p);
      expect(b.summary.failed === 0 && b.summary.stories === first.rows.length, `baselines written: ${b.summary.stories}`);
      r = pxsig(['check', '--full', '--project', p, '--retries', '1'], dir);
      const second = checkJson(dir, p);
      expect(r.status === 0 && second.rows.every((x) => x.pass), `second check passes: ${second.rows.filter((x) => x.pass).length}/${second.rows.length}${r.status ? `\n${r.stdout}` : ''}`);      // storybook.staticDir: nothing answers at the URL, so the check serves the build itself.
      r = pxsig(['check', '--full', '--project', p, '--retries', '1', '--storybook-url', 'http://127.0.0.1:1', '--storybook-static', join(dir, storybookDir, 'storybook-static')], dir);
      expect(r.status === 0 && /serving storybook\.staticDir/.test(r.stdout), `staticDir: the check serves the build itself and passes${r.status ? `\n${r.stdout}${r.stderr}` : ''}`);
      expect(!existsSync(join(dir, ...projectStore(dir, p), 'reports', '.lock')), 'the store lock is released');
    }
    // A visual change: rebuild Storybook, every project re-checks, only the changed component fails.
    log(`${name}: changing ${change.file}`);
    const f = join(dir, change.file);
    writeFileSync(f, readFileSync(f, 'utf8').replace(change.from, change.to));
    build();
    for (const p of projects) {
      const r = pxsig(['check', '--full', '--project', p, '--retries', '1'], dir);
      const rows = checkJson(dir, p).rows;
      const failed = rows.filter((x) => !x.pass).map((x) => x.id);
      const want = rows.filter((x) => change.affects(p, x.id)).map((x) => x.id);
      expect(JSON.stringify(failed.sort()) === JSON.stringify(want.sort()) && (want.length ? r.status === 1 : r.status === 0), `${p}: the change fails exactly ${want.length} entries (${failed.length} failed)`);
      const d = pxsig(['doctor', '--ci', '--project', p, '--json'], dir);
      expect(d.status === 0 || d.status === 1, `${p}: doctor --ci ran (exit ${d.status})`);
      const doc = JSON.parse(d.stdout);
      expect(!(doc.summary.bySeverity.error > 0), `${p}: no error-severity integrity codes (${doc.summary.headline})`);
    }
    if (name === 'monorepo') {
      const colocated = join(dir, 'packages/forms/src/TextField/__pxsig__');
      expect(existsSync(colocated) && readdirSync(colocated).some((n) => n.endsWith('.psig')), 'forms (colocated): baselines sit beside the component');
      expect(existsSync(join(dir, 'packages/ui/.pxsig/baselines')), 'ui (package): baselines in the package store');
      const ps = JSON.parse(pxsig(['projects', '--json'], dir).stdout);
      expect(ps.projects.map((x) => x.name).sort().join(',') === 'forms,ui', 'projects lists both');
    }
  } finally {
    server.close();
  }
  log(`${name}: done (${dir})`);
}

const examples = {
  'single-package': {
    projects: ['example-single'],
    storybookDir: '.',
    change: { file: 'src/Badge/Badge.jsx', from: "success: '#1f7a43'", to: "success: '#7a1f6a'", affects: (_p, id) => id.startsWith('components-badge--success') },
  },
  monorepo: {
    projects: ['ui', 'forms'],
    storybookDir: 'apps/storybook',
    // The ui Button changes colour: ui's accent entries and the forms story that renders a Button.
    change: { file: 'packages/ui/src/Button/Button.jsx', from: "'#2f5bea'", to: "'#c2410c'", affects: (p, id) => (p === 'ui' ? id.startsWith('ui-button--accent') : id.startsWith('forms-textfield--with-action')) },
  },
};

/** The dashboard rebuilt on a plain UI adapter, from the installed pxsig. */
function runCustomUi() {
  const name = 'custom-ui';
  log(`${name}: staging`);
  const dir = stage(name);
  sh('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile', '--config.confirmModulesPurge=false'], dir, { stdio: 'inherit' });
  let r = pxsig(['dashboard', 'gaps', '--json'], dir);
  const g = JSON.parse(r.stdout || '{}');
  const missing = (g.rows ?? []).filter((x) => x.status === 'missing');
  expect(r.status === 0 && !g.problems?.length, `gaps: no problems (exit ${r.status}${r.stderr ? `, ${r.stderr.trim()}` : ''})`);
  expect(missing.length > 0 && missing.every((x) => !x.required), `gaps: ${missing.length} optional components left to fallbacks, every required one present`);
  r = pxsig(['dashboard', 'build', '--out', 'dashboard-build'], dir);
  expect(r.status === 0 && existsSync(join(dir, 'dashboard-build', 'index.html')) && existsSync(join(dir, 'dashboard-build', 'assets', 'app.js')), `build: index.html and assets/app.js${r.status ? `\n${r.stdout}${r.stderr}` : ''}`);
  expect(!/type="module"/.test(readFileSync(join(dir, 'dashboard-build', 'index.html'), 'utf8')), 'build: a classic script, so a static report opens from disk');
  log(`${name}: done (${dir})`);
}

for (const [name, cfg] of Object.entries(examples)) if (!which || which === name) await run(name, cfg);
if (!which || which === 'custom-ui') runCustomUi();
console.log(failures ? `[examples] ${failures} failed` : '[examples] all passed');
process.exit(failures ? 1 : 0);
