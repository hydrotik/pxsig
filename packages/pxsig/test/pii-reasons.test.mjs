/**
 * pii-reasons.test.mjs — a reason given with a decision, and the person who made it, never reach a
 * file a repository commits: on `approvals.identity: "git-email"` (no longer read), with a reason
 * through every server route that takes one (approve, a11y-accept, a11y-prune) and a decision
 * through each that takes none (unreview, a11y-unaccept, a11y-unreview), and a reject's note
 * (reject, a11y-reject), in a repository whose git email and name are probes, no committed file
 * holds the probe email or name, the user name, the host name, the home folder, the reason or the
 * note; `<store>/reports/decisions.ndjson` (git-ignored) holds the reason, one line per reference,
 * and no email; `reports/rejections.json` holds the note. The scan beside pii.test.mjs's.
 *
 *   node --test packages/pxsig/test/pii-reasons.test.mjs
 *
 * Needs the Rust binary and git; skipped without them.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { sha256 } from '../src/lib/approvals.mjs';
import { decisionsFile } from '../src/lib/decisions.mjs';
import { STORE_GITIGNORE } from '../src/lib/setup/shared.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hasRust, rustBin } from './fixture.mjs';
import { serve } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

const EMAIL = 'pii-probe@example.invalid';
const NAME = 'Probe Q. Person';
const REASON = 'reviewed with the brand team on the new palette';
const NOTE = 'the swatch row clips on the right';
const git = spawnSync('git', ['--version']).status === 0;

/**
 * Every file under the repository but `.git` and the store's git-ignored folders.
 * @param {string} repo
 */
function committed(repo) {
  const skip = new Set(['.git', 'renders', 'diffs', 'reports', 'cache', 'history', 'trash']);
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }))
      if (!skip.has(e.name)) (e.isDirectory() ? walk : out.push.bind(out))(join(d, e.name));
  };
  walk(repo);
  return out;
}

test(
  'with git-email set, every route keeps the reason in reports/ and names no one in a committed file',
  { skip: skipUnless(hasRust && git, 'needs the Rust binary and git') },
  async (t) => {
    const f = fixture({ t });
    spawnSync('git', ['init', '-q', f.repo]);
    spawnSync('git', ['-C', f.repo, 'config', 'user.email', EMAIL]);
    spawnSync('git', ['-C', f.repo, 'config', 'user.name', NAME]);
    writeFileSync(join(f.px, '.gitignore'), STORE_GITIGNORE);
    const cfg = join(f.repo, 'pxsig.config.json');
    const c = JSON.parse(readFileSync(cfg, 'utf8'));
    writeFileSync(cfg, JSON.stringify({ ...c, approvals: { identity: 'git-email' } }, null, 2));
    const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
    const id = f.ids.a11y;
    const S = await serve(f);
    try {
      for (const [action, body] of /** @type {[string, object][]} */ ([
        ['approve', { id: f.ids.changed, reason: REASON }],
        ['unreview', { id: f.ids.changed }],
        ['approve', { id: f.ids.changed }],
        ['a11y-accept', { id }],
        ['a11y-unreview', { id }],
        ['a11y-accept', { id, reason: REASON }],
        ['a11y-unaccept', { id, rule: 'color-contrast' }],
        ['reject', { id: f.ids.changed, note: NOTE }],
        ['a11y-reject', { id, note: NOTE }],
      ])) {
        const r = await S.post(action, body);
        assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.body)}`);
      }
      writeFileSync(P.store.a11y, JSON.stringify({ [id]: ['color-contrast', 'region'] }));
      const plan = { a11ySha: sha256(P.store.a11y), prune: [{ id, rules: ['region'] }] };
      const r = await S.post('a11y-prune', { plan, reason: `${REASON}\nsecond line` });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    } finally {
      await S.stop();
    }
    const kept = readFileSync(decisionsFile(P), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.deepEqual(
      kept.map((l) => [l.log, l.reason]),
      [
        ['approvals', REASON],
        ['a11y', REASON],
        ['a11y', `${REASON} second line`],
      ]
    );
    assert.ok(!JSON.stringify(kept).includes(EMAIL), 'the local file names no person');
    // A rejection's note stays in the git-ignored reports/ too.
    const open = JSON.parse(readFileSync(join(P.store.reports, 'rejections.json'), 'utf8'));
    assert.deepEqual([open.visual[f.ids.changed].note, open.a11y[id].note], [NOTE, NOTE]);
    const probes = [
      ['the git email', EMAIL],
      ['the git name', NAME],
      ['the home folder', homedir()],
      ['the host name', hostname()],
      ['the reason', REASON],
      ['the note', NOTE],
      ...(userInfo().username.length >= 4 ? [['the user name', userInfo().username]] : []),
    ];
    const files = committed(f.repo);
    assert.ok(files.some((p) => p.endsWith('a11y-decisions.ndjson')));
    for (const file of files) {
      const text = readFileSync(file, 'latin1');
      for (const [what, value] of probes) {
        const at = new RegExp(
          `(^|[^\\w.-])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w.-])`
        ).test(text);
        assert.ok(!at, `${relative(f.repo, file)} names ${what}`);
      }
    }
  }
);
