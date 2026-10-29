/**
 * steps.mjs — the baseline, check.json, render-environment and warn-mode steps of examples-test.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @import { BaselineAnswer, DoctorAnswer, ExampleCheckJson } from '../types-release.js' */
import { repo, expect, sh, pxsig, pxsigIn, tail, projectStore } from './shared.mjs';

/**
 * Write baselines from the latest renders: what approving every NEW entry does. `withEnv`: each
 * baseline records its row's render environment from check.json, as approving in the dashboard does.
 * @param {string} dir
 * @param {string} project
 * @param {{ withEnv?: boolean }} [opts]
 * @returns {BaselineAnswer}
 */
export function baselineAll(dir, project, { withEnv = false } = {}) {
  let envArg = '';
  if (withEnv) {
    const c = checkJson(dir, project);
    const plan = join(dir, '.env-plan.json');
    writeFileSync(
      plan,
      JSON.stringify({
        envs: c.envs ?? {},
        byId: Object.fromEntries(c.rows.filter((r) => r.env).map((r) => [r.id, r.env])),
      })
    );
    envArg = `, '--env', ${JSON.stringify(`@${plan}`)}`;
  }
  const code = `
    const { openProject, writeRunManifest } = await import(${JSON.stringify(pathToFileURL(join(repo, 'packages/pxsig/src/lib/workspace.mjs')).href)});
    const P = openProject({ project: ${JSON.stringify(project)} });
    const run = writeRunManifest(P).path;
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(P.rustBin, ['baseline', '--manifest', run, '--png-dir', P.store.latest, '--root', P.workspaceRoot, '--json'${envArg}], { encoding: 'utf8' });
    process.stdout.write(r.stdout); process.exit(r.status);`;
  // The engine's `baseline --json` answer, printed by the script above.
  return /** @type {BaselineAnswer} */ (
    JSON.parse(sh(process.execPath, ['--input-type=module', '-e', code], dir).stdout)
  );
}

// check.json, as the check just run wrote it.
/** @type {(dir: string, project: string) => ExampleCheckJson} */
export const checkJson = (dir, project) =>
  /** @type {ExampleCheckJson} */ (
    JSON.parse(
      readFileSync(join(dir, ...projectStore(dir, project), 'reports', 'check.json'), 'utf8')
    )
  );

/**
 * The render environment end to end: same, then a forced font-probe difference, then strict.
 * @param {string} dir
 * @param {string} p
 */
export function envSteps(dir, p) {
  const b = baselineAll(dir, p, { withEnv: true });
  expect(
    b.summary.failed === 0,
    `baselines re-taken with their render environment: ${b.summary.stories}`
  );
  let r = pxsig(['check', '--full', '--project', p, '--retries', '1'], dir);
  let c = checkJson(dir, p);
  expect(
    r.status === 0 &&
      c.rows.every((x) => x.envMatch === 'same') &&
      !/\[check\] env:/.test(r.stdout),
    `env: every row is the same environment as its baseline (${[...new Set(c.rows.map((x) => x.envMatch))].join(', ')})`
  );
  // An extra probed font family changes the font digest: a major field, so a mismatch.
  const cfgPath = join(dir, 'pxsig.config.json');
  const cfg = readFileSync(cfgPath, 'utf8');
  writeFileSync(
    cfgPath,
    JSON.stringify(
      { .../** @type {object} */ (JSON.parse(cfg)), env: { fontProbe: ['Courier New'] } },
      null,
      2
    )
  );
  r = pxsig(['check', '--full', '--project', p, '--retries', '1'], dir);
  c = checkJson(dir, p);
  expect(
    r.status === 0 &&
      /\[check\] env: \d+ of \d+ entries rendered in a different environment than their baseline \(fonts\.probe: Courier New\)/.test(
        r.stdout
      ),
    `env: a font difference warns and the check still passes (exit ${r.status})`
  );
  expect(
    c.summary.envMismatch === c.rows.length,
    `env: summary.envMismatch counts every entry (${c.summary.envMismatch})`
  );
  // `doctor --json`'s answer.
  const d = /** @type {DoctorAnswer} */ (
    JSON.parse(pxsig(['doctor', '--project', p, '--json'], dir).stdout)
  );
  const finding = (d.setup ?? []).filter((x) => x.code === 'env-mismatch');
  expect(
    finding.length === 1 && finding[0].severity === 'warn',
    'env: one env-mismatch setup warning in doctor'
  );
  r = pxsig(['check', '--full', '--project', p, '--retries', '1', '--strict-env'], dir);
  expect(
    r.status === 2 &&
      /different environment/.test(r.stderr) &&
      !/\[check\] rendered/.test(r.stdout),
    `env: --strict-env refuses before rendering (exit ${r.status})`
  );
  // The env gate on warn: --strict-env's refusal becomes a would-have-refused, and the check renders.
  writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        .../** @type {object} */ (JSON.parse(cfg)),
        env: { fontProbe: ['Courier New'] },
        enforcement: { gates: { env: 'warn' } },
      },
      null,
      2
    )
  );
  r = pxsigIn(['check', '--full', '--project', p, '--retries', '1', '--strict-env'], dir);
  expect(
    r.status === 0 &&
      /--strict-env would have refused this run/.test(r.stdout) &&
      /\[check\] rendered/.test(r.stdout) &&
      /\[pxsig\] ADVISORY: would have failed \(exit 2\)/.test(r.stdout),
    `warn: the env gate on warn renders past --strict-env (exit ${r.status})${r.status ? tail(r) : ''}`
  );
  writeFileSync(cfgPath, cfg);
}

/**
 * Warn mode end to end, on the changed component's failing entries.
 * @param {string} dir
 * @param {string} p
 * @param {string[]} failing
 */
export function warnSteps(dir, p, failing) {
  const cfgPath = join(dir, 'pxsig.config.json');
  const cfg = readFileSync(cfgPath, 'utf8');
  writeFileSync(
    cfgPath,
    JSON.stringify(
      { .../** @type {object} */ (JSON.parse(cfg)), enforcement: { gates: { visual: 'warn' } } },
      null,
      2
    )
  );
  const store = join(dir, ...projectStore(dir, p), 'reports');
  let r = pxsigIn(['check', '--full', '--project', p, '--retries', '1'], dir);
  const c = checkJson(dir, p);
  const now = c.rows
    .filter((x) => !x.pass)
    .map((x) => x.id)
    .sort();
  expect(
    r.status === 0,
    `warn: the visual gate on warn exits 0 (exit ${r.status})${r.status ? tail(r) : ''}`
  );
  expect(
    JSON.stringify(now) === JSON.stringify([...failing].sort()),
    `warn: the same ${failing.length} rows fail as under enforce (${now.length})`
  );
  expect(
    /^\[pxsig\] ADVISORY: warn mode for visual \(pxsig\.config\.json\)/m.test(r.stdout) &&
      new RegExp(
        `\\[pxsig\\] ADVISORY: would have failed \\(exit 1\\): ${failing.length} changed\\. Not blocking\\.`
      ).test(r.stdout),
    'warn: the ADVISORY lead and last lines'
  );
  expect(
    c.enforcement?.wouldFail === true &&
      c.enforcement.contexts.advisory.includes('visual') &&
      c.git &&
      'head' in c.git,
    'warn: check.json carries enforcement and git.head (null here: the example is not a git repository)'
  );
  expect(
    readFileSync(join(store, 'summary.md'), 'utf8').startsWith(
      '> **ADVISORY: warn mode** (visual). This run would have failed'
    ),
    'warn: summary.md opens with the advisory lead'
  );
  expect(
    readFileSync(join(store, 'junit.xml'), 'utf8').includes(
      '<property name="pxsig.enforcement" value="warn"/>'
    ) && readFileSync(join(store, 'junit.xml'), 'utf8').includes('<failure'),
    'warn: junit keeps its failures and says warn'
  );
  r = pxsigIn(['check', '--full', '--project', p, '--retries', '1', '--enforce'], dir);
  expect(r.status === 1, `warn: --enforce fails it again (exit ${r.status})`);
  r = pxsigIn(['check', '--full', '--project', p, '--retries', '1'], dir, {
    PXSIG_ENFORCEMENT: 'enforce',
  });
  expect(r.status === 1, `warn: PXSIG_ENFORCEMENT=enforce fails it again (exit ${r.status})`);
  r = pxsigIn(['check', '--full', '--project', p, '--retries', '1'], dir, {
    PXSIG_ENFORCEMENT: 'warn',
  });
  expect(
    r.status === 2 && /PXSIG_ENFORCEMENT=warn is refused/.test(r.stderr),
    `warn: PXSIG_ENFORCEMENT=warn is refused (exit ${r.status})`
  );
  writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        .../** @type {object} */ (JSON.parse(cfg)),
        enforcement: { gates: { visual: 'warn' }, advisoryExit: 78 },
      },
      null,
      2
    )
  );
  r = pxsigIn(['check', '--full', '--project', p, '--retries', '1'], dir);
  expect(r.status === 78, `warn: advisoryExit 78 (exit ${r.status})`);
  writeFileSync(cfgPath, cfg);
}
