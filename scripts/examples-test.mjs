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
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** @import { DoctorAnswer, Example, ProjectsAnswer } from './types-release.js' */
import {
  log,
  expect,
  env,
  pxsig,
  pnpm,
  stage,
  serveStatic,
  failureCount,
  projectStore,
} from './examples/shared.mjs';
import { baselineAll, checkJson, envSteps, warnSteps } from './examples/steps.mjs';
import { runCustomUi } from './examples/custom-ui.mjs';

const which = process.argv[2];

/**
 * @param {string} name
 * @param {Example} example
 */
async function run(name, { projects, storybookDir, change }) {
  log(`${name}: staging`);
  const dir = stage(name);
  log(`${name}: pnpm install in ${dir}`);
  pnpm(
    ['install', '--ignore-workspace', '--no-frozen-lockfile', '--config.confirmModulesPurge=false'],
    dir,
    { stdio: 'inherit' }
  );
  if (existsSync(join(dir, 'pnpm-workspace.yaml')))
    pnpm(['install', '--no-frozen-lockfile'], dir, { stdio: 'inherit' });
  const build = () => pnpm(['build-storybook'], dir, { stdio: 'inherit' });
  build();
  const server = await serveStatic(join(dir, storybookDir, 'storybook-static'));
  // The configured port may be in use on this machine: point every project at this server.
  env.PXSIG_STORYBOOK_URL = `http://127.0.0.1:${server.port}`;
  try {
    for (const p of projects) {
      log(`${name}/${p}: manifest`);
      let r = pxsig(['manifest', '--project', p], dir);
      expect(
        r.status === 0,
        `manifest (${r.stdout.match(/Entries[^\n]*/)?.[0] ?? r.stderr.trim()})`
      );
      r = pxsig(['check', '--full', '--project', p, '--retries', '0'], dir);
      const first = checkJson(dir, p);
      expect(
        r.status === 1 && first.rows.every((x) => !x.pass),
        `first check: every entry is NEW (${first.rows.length})`
      );
      const b = baselineAll(dir, p);
      expect(
        b.summary.failed === 0 && b.summary.stories === first.rows.length,
        `baselines written: ${b.summary.stories}`
      );
      r = pxsig(['check', '--full', '--project', p, '--retries', '1'], dir);
      const second = checkJson(dir, p);
      expect(
        r.status === 0 && second.rows.every((x) => x.pass),
        `second check passes: ${second.rows.filter((x) => x.pass).length}/${second.rows.length}${r.status ? `\n${r.stdout}` : ''}`
      ); // storybook.staticDir: nothing answers at the URL, so the check serves the build itself.
      r = pxsig(
        [
          'check',
          '--full',
          '--project',
          p,
          '--retries',
          '1',
          '--storybook-url',
          'http://127.0.0.1:1',
          '--storybook-static',
          join(dir, storybookDir, 'storybook-static'),
        ],
        dir
      );
      expect(
        r.status === 0 && /serving storybook\.staticDir/.test(r.stdout),
        `staticDir: the check serves the build itself and passes${r.status ? `\n${r.stdout}${r.stderr}` : ''}`
      );
      expect(
        !existsSync(join(dir, ...projectStore(dir, p), 'reports', '.lock')),
        'the store lock is released'
      );
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
      expect(
        JSON.stringify(failed.sort()) === JSON.stringify(want.sort()) &&
          (want.length ? r.status === 1 : r.status === 0),
        `${p}: the change fails exactly ${want.length} entries (${failed.length} failed)`
      );
      if (name === 'single-package') warnSteps(dir, p, failed);
      const d = pxsig(['doctor', '--ci', '--project', p, '--json'], dir);
      expect(d.status === 0 || d.status === 1, `${p}: doctor --ci ran (exit ${d.status})`);
      // `doctor --json`'s answer.
      const doc = /** @type {DoctorAnswer} */ (JSON.parse(d.stdout));
      expect(
        !(doc.summary.bySeverity.error > 0),
        `${p}: no error-severity integrity codes (${doc.summary.headline})`
      );
    }
    if (name === 'monorepo') {
      const colocated = join(dir, 'packages/forms/src/TextField/__pxsig__');
      expect(
        existsSync(colocated) && readdirSync(colocated).some((n) => n.endsWith('.psig')),
        'forms (colocated): baselines sit beside the component'
      );
      expect(
        existsSync(join(dir, 'packages/ui/.pxsig/baselines')),
        'ui (package): baselines in the package store'
      );
      // `projects --json`'s answer.
      const ps = /** @type {ProjectsAnswer} */ (
        JSON.parse(pxsig(['projects', '--json'], dir).stdout)
      );
      expect(
        ps.projects
          .map((x) => x.name)
          .sort()
          .join(',') === 'forms,ui',
        'projects lists both'
      );
    }
  } finally {
    server.close();
  }
  log(`${name}: done (${dir})`);
}

/** @type {Record<string, Example>} */
const examples = {
  'single-package': {
    projects: ['example-single'],
    storybookDir: '.',
    change: {
      file: 'src/Badge/Badge.jsx',
      from: "success: '#1f7a43'",
      to: "success: '#7a1f6a'",
      affects: (_p, id) => id.startsWith('components-badge--success'),
    },
  },
  monorepo: {
    projects: ['ui', 'forms'],
    storybookDir: 'apps/storybook',
    // The ui Button changes colour: ui's accent entries and the forms story that renders a Button.
    change: {
      file: 'packages/ui/src/Button/Button.jsx',
      from: "'#2f5bea'",
      to: "'#c2410c'",
      affects: (p, id) =>
        p === 'ui'
          ? id.startsWith('ui-button--accent')
          : id.startsWith('forms-textfield--with-action'),
    },
  },
};

for (const [name, cfg] of Object.entries(examples))
  if (!which || which === name) await run(name, cfg);
if (!which || which === 'custom-ui') runCustomUi();
console.log(failureCount() ? `[examples] ${failureCount()} failed` : '[examples] all passed');
process.exit(failureCount() ? 1 : 0);
