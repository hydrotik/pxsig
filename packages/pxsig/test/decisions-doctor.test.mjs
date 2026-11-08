/**
 * decisions-doctor.test.mjs — the setup finding `reports-not-ignored` (lib/integrity/problems.mjs
 * `decisionProblems`): a store whose reports/ git would pick up keeps no reason, and doctor says
 * so, as a warning `integrity.severity` can change. Fixture projects in real git repositories.
 *
 *   node --test packages/pxsig/test/decisions-doctor.test.mjs
 *
 * Needs git (skipped without it).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { forgetIgnored } from '../src/lib/decisions.mjs';
import { reconcile, resolveContext } from '../src/lib/integrity.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, rustBin } from './fixture.mjs';
import { skipUnless } from './strict.mjs';

const hasGit = spawnSync('git', ['--version']).status === 0;
const skip = skipUnless(hasGit, 'git missing');

/**
 * The fixture's setup findings for one code, in a real repository, with `config` merged in.
 * @param {ReturnType<typeof fixture>} f
 * @param {Record<string, unknown>} [config]
 */
async function finding(f, config = {}) {
  const cfg = join(f.repo, 'pxsig.config.json');
  writeFileSync(cfg, JSON.stringify({ ...JSON.parse(readFileSync(cfg, 'utf8')), ...config }));
  forgetIgnored();
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
  const led = await reconcile(resolveContext(P), { index: f.index, affected: f.affected });
  return led.setup.filter((x) => x.code === 'reports-not-ignored');
}

test(
  'reports-not-ignored: a warning while git would pick up reports/; none once ignored',
  { skip },
  async (t) => {
    const f = fixture({ t });
    assert.deepEqual(await finding(f), [], 'in no repository: nothing can be committed');
    spawnSync('git', ['init', '-q', f.repo]);
    const [w, ...more] = await finding(f);
    assert.equal(more.length, 0);
    assert.deepEqual(w, {
      code: 'reports-not-ignored',
      severity: 'warn',
      reason:
        '.pxsig/reports/ is not git-ignored: reasons given with a decision are not kept, so none can be committed. Add `reports/` to .pxsig/.gitignore (pxsig init writes it)',
    });
    assert.ok(!w.reason.includes(f.repo), 'store-relative, never absolute');
    const severity = { 'reports-not-ignored': 'info' };
    const [o] = await finding(f, { integrity: { severity } });
    assert.equal(o.severity, 'info', 'integrity.severity overrides it');
    writeFileSync(join(f.px, '.gitignore'), 'reports/\n');
    assert.deepEqual(await finding(f), []);
  }
);
