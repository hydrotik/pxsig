/**
 * decisions-doctor.test.mjs — the setup findings of lib/integrity/problems.mjs `decisionProblems`:
 * `reports-not-ignored` (a store whose reports/ git would pick up keeps no reason),
 * `approvals-identity` (a config that still has the key no pxsig reads) and `log-legacy-personal`
 * (lines from before 0.7.6 with a reason or a `by`), each with a severity `integrity.severity` can
 * change. Fixture projects in real git repositories.
 *
 *   node --test packages/pxsig/test/decisions-doctor.test.mjs
 *
 * Needs git (skipped without it).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
 * @param {string} [code]
 */
async function finding(f, config = {}, code = 'reports-not-ignored') {
  const cfg = join(f.repo, 'pxsig.config.json');
  writeFileSync(cfg, JSON.stringify({ ...JSON.parse(readFileSync(cfg, 'utf8')), ...config }));
  forgetIgnored();
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
  const led = await reconcile(resolveContext(P), { index: f.index, affected: f.affected });
  return led.setup.filter((x) => x.code === code);
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

test('approvals-identity: the key loads, and doctor names it: warn for git-email, info for none', async (t) => {
  const f = fixture({ t });
  assert.deepEqual(await finding(f, {}, 'approvals-identity'), []);
  const reason =
    'approvals.identity is no longer read: log lines carry a decision reference, never a name. Remove the key from pxsig.config.json';
  for (const [identity, severity] of [
    ['git-email', 'warn'],
    ['none', 'info'],
  ])
    assert.deepEqual(await finding(f, { approvals: { identity } }, 'approvals-identity'), [
      { code: 'approvals-identity', severity, reason },
    ]);
  const integrity = { severity: { 'approvals-identity': 'error' } };
  const [o] = await finding(
    f,
    { approvals: { identity: 'git-email' }, integrity },
    'approvals-identity'
  );
  assert.equal(o.severity, 'error', 'integrity.severity overrides it');
});

test('approvals-identity names the file that sets the key: project config, workspace defaults, both', async (t) => {
  const f = fixture({ t });
  const lead =
    'approvals.identity is no longer read: log lines carry a decision reference, never a name. Remove the key from ';
  /** @param {Record<string, unknown>} config @param {Record<string, unknown> | null} defaults */
  const reason = async (config, defaults) => {
    const ws = { projects: { app: '.' }, ...(defaults ? { defaults } : {}) };
    writeFileSync(join(f.repo, 'pxsig.workspace.json'), JSON.stringify(ws));
    const cfg = JSON.parse(readFileSync(join(f.repo, 'pxsig.config.json'), 'utf8'));
    delete cfg.approvals;
    writeFileSync(join(f.repo, 'pxsig.config.json'), JSON.stringify(cfg));
    const [o, ...more] = await finding(f, config, 'approvals-identity');
    assert.equal(more.length, 0);
    assert.ok(!o.reason.includes(f.repo), 'file names, never absolute paths');
    return o.reason.slice(lead.length);
  };
  const set = { approvals: { identity: 'git-email' } };
  assert.equal(await reason(set, null), 'pxsig.config.json');
  assert.equal(await reason({}, set), 'pxsig.workspace.json (defaults.approvals)');
  assert.equal(
    await reason(set, set),
    'pxsig.config.json and pxsig.workspace.json (defaults.approvals)'
  );
});

test("log-legacy-personal: counts old lines with a reason or a `by`, never pxsig's own", async (t) => {
  const f = fixture({ t });
  const code = 'log-legacy-personal';
  assert.deepEqual(await finding(f, {}, code), [], 'a store of 0.7.6 lines: nothing');
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
  const at = '2026-01-01T00:00:00.000Z';
  /** @param {object[]} ls */
  const nd = (ls) =>
    ls.map((l) => `${JSON.stringify({ at, id: 'x', batch: 'b', ...l })}\n`).join('');
  writeFileSync(
    P.store.approvals,
    nd([
      { via: 'cli', reason: 'a person wrote this' },
      { via: 'dashboard', reason: null, by: 'old@example.test' },
      { via: 'check-update', reason: 'pxsig check --update' },
      { via: 'undo', reason: 'undo b (dashboard)' },
      { via: 'adopt', reason: 'adopt current baselines as the starting point' },
      { via: 'migrate', reason: 'moved from x', by: 'pxsig migrate' },
      { via: 'cli', ref: 'd_new' },
    ])
  );
  writeFileSync(
    join(dirname(P.store.a11y), 'a11y-decisions.ndjson'),
    nd([
      { via: 'dashboard', action: 'accept', by: 'old@example.test' },
      { via: 'cli', ref: 'd_y' },
    ])
  );
  assert.deepEqual(await finding(f, {}, code), [
    {
      code,
      severity: 'info',
      count: 3,
      reason:
        '2 lines of approvals.ndjson and 1 of a11y-decisions.ndjson, written before 0.7.6, carry a reason or a git email. New lines carry neither; old lines stay (the log is append-only, and git history keeps them either way)',
    },
  ]);
  const [o] = await finding(f, { integrity: { severity: { [code]: 'warn' } } }, code);
  assert.equal(o.severity, 'warn', 'integrity.severity overrides it');
});
