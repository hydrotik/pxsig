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
 *   4b. env          (single-package) baselines re-taken with their render environment; a
 *                    forced font-probe difference warns (exit 0, one setup finding), and
 *                    --strict-env refuses it (exit 2)
 *   5. change        a component's colour changes; the check fails on exactly its entries
 *   5b. warn         (single-package) the visual gate on warn: the same failing rows, exit 0,
 *                    ADVISORY lines, `enforcement` in check.json, the summary.md lead and the
 *                    junit property; --enforce and PXSIG_ENFORCEMENT=enforce fail it again,
 *                    PXSIG_ENFORCEMENT=warn is refused; the env gate on warn renders past
 *                    --strict-env
 *   6. doctor --ci   no error-severity integrity codes
 * And custom-ui (no Storybook): `pxsig dashboard gaps` reports the plain adapter's gaps,
 * `pxsig dashboard build` rebuilds the dashboard on it from the installed pxsig, and `pxsig
 * dashboard check` renders every feature's screens on that build in both themes (its summary goes
 * to the job summary on GitHub Actions).
 * Needs pnpm, network access for the installs, Playwright's Chromium, and the Rust binary
 * (`cargo build --release`, or PXSIG_BIN).
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
// Warn-mode runs write a readiness line in the machine's state folder: point it at a temp folder.
// Playwright finds its browsers under the same folders, so its own path stays where they are.
const stateHome = mkdtempSync(join(tmpdir(), 'pxsig-example-state-'));
const browsers =
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
  (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright') : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright'));
const pxsigIn = (args, cwd, extra = {}) => sh(process.execPath, [cli, ...args], cwd, { must: false, env: { ...env, HOME: stateHome, USERPROFILE: stateHome, XDG_STATE_HOME: stateHome, LOCALAPPDATA: stateHome, PLAYWRIGHT_BROWSERS_PATH: browsers, ...extra } });
const tail = (r) => `\n${r.stdout.split('\n').slice(-15).join('\n')}\n${r.stderr.split('\n').slice(-15).join('\n')}`;
// pnpm is a .cmd shim on Windows, which Node starts only through a shell. This is the test
// harness on a CI runner; pxsig itself never starts a shell (docs/platforms.md).
const pnpm = (args, cwd, opts = {}) => (process.platform === 'win32' ? sh('pnpm.cmd', args, cwd, { ...opts, shell: true }) : sh('pnpm', args, cwd, opts));

/** Copy an example, rewriting `link:` dependencies to this checkout's packages. */
function stage(name) {
  // On the checkout's drive: Storybook names a cache folder after the path from the example to a
  // linked package, which across Windows drives contains "D:" and cannot be created.
  const dir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), `pxsig-example-${name}-`));
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

/**
 * Write baselines from the latest renders: what approving every NEW entry does. `withEnv`: each
 * baseline records its row's render environment from check.json, as approving in the dashboard does.
 */
function baselineAll(dir, project, { withEnv = false } = {}) {
  let envArg = '';
  if (withEnv) {
    const c = checkJson(dir, project);
    const plan = join(dir, '.env-plan.json');
    writeFileSync(plan, JSON.stringify({ envs: c.envs ?? {}, byId: Object.fromEntries(c.rows.filter((r) => r.env).map((r) => [r.id, r.env])) }));
    envArg = `, '--env', ${JSON.stringify(`@${plan}`)}`;
  }
  const code = `
    const { openProject, writeRunManifest } = await import(${JSON.stringify(pathToFileURL(join(repo, 'packages/pxsig/src/lib/workspace.mjs')).href)});
    const P = openProject({ project: ${JSON.stringify(project)} });
    const run = writeRunManifest(P).path;
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(P.rustBin, ['baseline', '--manifest', run, '--png-dir', P.store.latest, '--root', P.workspaceRoot, '--json'${envArg}], { encoding: 'utf8' });
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
  pnpm(['install', '--ignore-workspace', '--no-frozen-lockfile', '--config.confirmModulesPurge=false'], dir, { stdio: 'inherit' });
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) pnpm(['install', '--no-frozen-lockfile'], dir, { stdio: 'inherit' });
  const build = () => pnpm(['build-storybook'], dir, { stdio: 'inherit' });
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
      if (name === 'single-package') envSteps(dir, p);
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
      if (name === 'single-package') warnSteps(dir, p, failed);
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

/** The render environment end to end: same, then a forced font-probe difference, then strict. */
function envSteps(dir, p) {
  const b = baselineAll(dir, p, { withEnv: true });
  expect(b.summary.failed === 0, `baselines re-taken with their render environment: ${b.summary.stories}`);
  let r = pxsig(['check', '--full', '--project', p, '--retries', '1'], dir);
  let c = checkJson(dir, p);
  expect(r.status === 0 && c.rows.every((x) => x.envMatch === 'same') && !/\[check\] env:/.test(r.stdout), `env: every row is the same environment as its baseline (${[...new Set(c.rows.map((x) => x.envMatch))].join(', ')})`);
  // An extra probed font family changes the font digest: a major field, so a mismatch.
  const cfgPath = join(dir, 'pxsig.config.json');
  const cfg = readFileSync(cfgPath, 'utf8');
  writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(cfg), env: { fontProbe: ['Courier New'] } }, null, 2));
  r = pxsig(['check', '--full', '--project', p, '--retries', '1'], dir);
  c = checkJson(dir, p);
  expect(r.status === 0 && /\[check\] env: \d+ of \d+ entries rendered in a different environment than their baseline \(fonts\.probe: Courier New\)/.test(r.stdout), `env: a font difference warns and the check still passes (exit ${r.status})`);
  expect(c.summary.envMismatch === c.rows.length, `env: summary.envMismatch counts every entry (${c.summary.envMismatch})`);
  const d = JSON.parse(pxsig(['doctor', '--project', p, '--json'], dir).stdout);
  const finding = (d.setup ?? []).filter((x) => x.code === 'env-mismatch');
  expect(finding.length === 1 && finding[0].severity === 'warn', 'env: one env-mismatch setup warning in doctor');
  r = pxsig(['check', '--full', '--project', p, '--retries', '1', '--strict-env'], dir);
  expect(r.status === 2 && /different environment/.test(r.stderr) && !/\[check\] rendered/.test(r.stdout), `env: --strict-env refuses before rendering (exit ${r.status})`);
  // The env gate on warn: --strict-env's refusal becomes a would-have-refused, and the check renders.
  writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(cfg), env: { fontProbe: ['Courier New'] }, enforcement: { gates: { env: 'warn' } } }, null, 2));
  r = pxsigIn(['check', '--full', '--project', p, '--retries', '1', '--strict-env'], dir);
  expect(r.status === 0 && /--strict-env would have refused this run/.test(r.stdout) && /\[check\] rendered/.test(r.stdout) && /\[pxsig\] ADVISORY: would have failed \(exit 2\)/.test(r.stdout), `warn: the env gate on warn renders past --strict-env (exit ${r.status})${r.status ? tail(r) : ''}`);
  writeFileSync(cfgPath, cfg);
}

/** Warn mode end to end, on the changed component's failing entries. */
function warnSteps(dir, p, failing) {
  const cfgPath = join(dir, 'pxsig.config.json');
  const cfg = readFileSync(cfgPath, 'utf8');
  writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(cfg), enforcement: { gates: { visual: 'warn' } } }, null, 2));
  const store = join(dir, ...projectStore(dir, p), 'reports');
  let r = pxsigIn(['check', '--full', '--project', p, '--retries', '1'], dir);
  const c = checkJson(dir, p);
  const now = c.rows.filter((x) => !x.pass).map((x) => x.id).sort();
  expect(r.status === 0, `warn: the visual gate on warn exits 0 (exit ${r.status})${r.status ? tail(r) : ''}`);
  expect(JSON.stringify(now) === JSON.stringify([...failing].sort()), `warn: the same ${failing.length} rows fail as under enforce (${now.length})`);
  expect(/^\[pxsig\] ADVISORY: warn mode for visual \(pxsig\.config\.json\)/m.test(r.stdout) && new RegExp(`\\[pxsig\\] ADVISORY: would have failed \\(exit 1\\): ${failing.length} changed\\. Not blocking\\.`).test(r.stdout), 'warn: the ADVISORY lead and last lines');
  expect(c.enforcement?.wouldFail === true && c.enforcement.contexts.advisory.includes('visual') && c.git && 'head' in c.git, 'warn: check.json carries enforcement and git.head (null here: the example is not a git repository)');
  expect(readFileSync(join(store, 'summary.md'), 'utf8').startsWith('> **ADVISORY: warn mode** (visual). This run would have failed'), 'warn: summary.md opens with the advisory lead');
  expect(readFileSync(join(store, 'junit.xml'), 'utf8').includes('<property name="pxsig.enforcement" value="warn"/>') && readFileSync(join(store, 'junit.xml'), 'utf8').includes('<failure'), 'warn: junit keeps its failures and says warn');
  r = pxsigIn(['check', '--full', '--project', p, '--retries', '1', '--enforce'], dir);
  expect(r.status === 1, `warn: --enforce fails it again (exit ${r.status})`);
  r = pxsigIn(['check', '--full', '--project', p, '--retries', '1'], dir, { PXSIG_ENFORCEMENT: 'enforce' });
  expect(r.status === 1, `warn: PXSIG_ENFORCEMENT=enforce fails it again (exit ${r.status})`);
  r = pxsigIn(['check', '--full', '--project', p, '--retries', '1'], dir, { PXSIG_ENFORCEMENT: 'warn' });
  expect(r.status === 2 && /PXSIG_ENFORCEMENT=warn is refused/.test(r.stderr), `warn: PXSIG_ENFORCEMENT=warn is refused (exit ${r.status})`);
  writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(cfg), enforcement: { gates: { visual: 'warn' }, advisoryExit: 78 } }, null, 2));
  r = pxsigIn(['check', '--full', '--project', p, '--retries', '1'], dir);
  expect(r.status === 78, `warn: advisoryExit 78 (exit ${r.status})`);
  writeFileSync(cfgPath, cfg);
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
  pnpm(['install', '--ignore-workspace', '--no-frozen-lockfile', '--config.confirmModulesPurge=false'], dir, { stdio: 'inherit' });
  let r = pxsig(['dashboard', 'gaps', '--json'], dir);
  const g = JSON.parse(r.stdout || '{}');
  const missing = (g.rows ?? []).filter((x) => x.status === 'missing');
  expect(r.status === 0 && !g.problems?.length, `gaps: no problems (exit ${r.status}${r.stderr ? `, ${r.stderr.trim()}` : ''})`);
  expect(missing.length > 0 && missing.every((x) => !x.required), `gaps: ${missing.length} optional components left to fallbacks, every required one present`);
  r = pxsig(['dashboard', 'build', '--out', 'dashboard-build'], dir);
  expect(r.status === 0 && existsSync(join(dir, 'dashboard-build', 'index.html')) && existsSync(join(dir, 'dashboard-build', 'assets', 'app.js')), `build: index.html and assets/app.js${r.status ? `\n${r.stdout}${r.stderr}` : ''}`);
  expect(!/type="module"/.test(readFileSync(join(dir, 'dashboard-build', 'index.html'), 'utf8')), 'build: a classic script, so a static report opens from disk');
  const stamp = JSON.parse(readFileSync(join(dir, 'dashboard-build', 'pxsig-build.json'), 'utf8'));
  expect(stamp.pxsig, 'build: stamped with the pxsig version, for serve');
  expect(stamp.contract && stamp.adapterContract === '1.0.0', `build: stamped with the UI contract (${stamp.contract}) and the adapter's (${stamp.adapterContract})`);
  r = pxsig(['dashboard', 'gaps', '--json'], dir);
  expect(JSON.parse(r.stdout).contract?.status === 'same', 'gaps: the adapter is written for this contract');
  // Every feature on a design system other than the reference, from the shipped sample data.
  r = pxsig(['dashboard', 'check', '--build', 'dashboard-build', '--json'], dir);
  let c = {};
  try {
    c = JSON.parse(r.stdout || '{}');
  } catch {
    c = {};
  }
  const s = c.summary ?? {};
  const failed = (c.screens ?? []).filter((x) => !x.rendered).map((x) => `${x.feature} #${x.index + 1} ${x.theme}: ${x.reason}`);
  expect(r.status === 0 && s.screens > 0 && s.failed === 0, `check: ${s.rendered ?? 0} of ${s.screens ?? 0} screens rendered, both themes${r.status ? ` (exit ${r.status}${failed.length ? `: ${failed.join('; ')}` : ''}${r.stderr ? `, ${r.stderr.trim()}` : ''})` : ''}`);
  const out = join(dir, 'node_modules', '.cache', 'pxsig', 'dashboard-check');
  expect(existsSync(join(out, 'index.html')) && existsSync(join(out, 'summary.md')), 'check: the gallery and summary.md');
  if (process.env.GITHUB_STEP_SUMMARY && existsSync(join(out, 'summary.md'))) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${readFileSync(join(out, 'summary.md'), 'utf8')}\n`);
  log(`${name}: done (${dir})`);
}

for (const [name, cfg] of Object.entries(examples)) if (!which || which === name) await run(name, cfg);
if (!which || which === 'custom-ui') runCustomUi();
console.log(failures ? `[examples] ${failures} failed` : '[examples] all passed');
process.exit(failures ? 1 : 0);
