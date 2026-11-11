/**
 * approve-masks.test.mjs — a masks change in the approval paths (mask audit 2 and 12): `approve
 * plan` treats it as its own class, blocked unless named in `--allow-masks`, never passed as colour
 * or shape; masks no approval passes stay blocked; `approve apply` logs `kind: "masks"` with what
 * changed; the dashboard's Approve story leaves such an entry out; the server refuses to approve
 * masks no approval passes. A fixture project whose check.json row carries the engine's fields, and
 * a live `pxsig serve` on its own port for the writes.
 *
 *   node --test packages/pxsig/test/approve-masks.test.mjs
 */
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { detectAgent } from '../src/lib/agents.mjs';
import { paths, readLog } from '../src/lib/approvals.mjs';
import { storySkip } from '../src/lib/approvals/story.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hasRust, png, rustBin, testEnv, testHome } from './fixture.mjs';
import { serve, src } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

/** @import { CheckRow, ManifestEntry } from '../src/types.js' */
/** @typedef {ReturnType<typeof fixture>} Fixture */

const skip = skipUnless(hasRust, 'Rust binary not built');
const NO_SERVER = 'http://127.0.0.1:1';
const REASON = 'the clock is volatile, reviewed in the dashboard';
// The same thumb as the fixture's baseline, recoloured: colour only, the masks aside.
const STRIPES = png(128, 128, (x) => (x % 16 < 8 ? [200, 60, 60] : [250, 250, 250]));
const CHANGED = {
  added: ['[data-volatile="relative time"]'],
  removed: [],
  grew: [],
  moved: [],
  count: [],
};

/**
 * A person at a terminal (as in approve-flow.test.mjs): `pxsig approve …`.
 * @param {Fixture} f
 * @param {string[]} args
 * @param {{ input?: string, url?: string }} [opts]
 */
function person(f, args, { input = '', url = NO_SERVER } = {}) {
  const preload = join(f.repo, 'tty-preload.mjs');
  if (!existsSync(preload))
    writeFileSync(preload, 'process.stdin.isTTY = true;\nprocess.stdout.isTTY = true;\n');
  /** @type {Record<string, string | undefined>} */
  const env = { ...testEnv(testHome), PXSIG_URL: url, PXSIG_BIN: rustBin, PXSIG_FORMAT: 'plain' };
  delete env.CI;
  for (let a = detectAgent(env); a; a = detectAgent(env)) delete env[a.variable];
  const child = spawn(
    process.execPath,
    ['--import', pathToFileURL(preload).href, join(src, 'cli.mjs'), 'approve', ...args],
    { cwd: f.repo, env, timeout: 60_000 }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  child.stdin.end(input);
  return /** @type {Promise<{ status: number | null, stdout: string, stderr: string }>} */ (
    new Promise((ok) => child.on('close', (status) => ok({ status, stdout, stderr })))
  );
}

/**
 * A fixture whose changed entry has a new render and, in check.json, the engine's mask fields.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {Partial<CheckRow>} masks
 */
function store(t, masks) {
  const f = fixture({ t });
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
  const id = f.ids.changed;
  const p = paths(
    P,
    /** @type {ManifestEntry} */ (f.manifest.stories.find((e) => e.id === id))
  );
  writeFileSync(p.latestPng, STRIPES);
  const old = new Date(Date.now() - 3 * 3_600_000);
  utimesSync(p.latestPng, old, old);
  const file = join(f.repo, '.pxsig/reports/check.json');
  const report = JSON.parse(readFileSync(file, 'utf8'));
  for (const r of report.rows) if (r.id === id) Object.assign(r, masks);
  writeFileSync(file, JSON.stringify(report));
  utimesSync(file, old, old);
  return { f, P, id };
}

/**
 * The plan's one entry.
 * @param {string} reports the store's reports folder
 */
const planOf = (reports) =>
  JSON.parse(readFileSync(join(reports, 'approval-plan.json'), 'utf8')).entries[0];

test(
  'plan: a masks change is its own class, blocked unless named in --allow-masks',
  { skip },
  async (t) => {
    // Mask audit 2: `approve plan --all-changed` passed a new mask as "colour only".
    const { f, P, id } = store(t, { masksChanged: CHANGED });
    const plan = ['plan', id, '--reason', REASON, '--allow-shape', id];
    let r = await person(f, plan);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    let e = planOf(P.store.reports);
    assert.equal(e.kind, 'masks');
    assert.equal(e.status, 'blocked', 'never passed as colour or shape');
    assert.match(
      e.why,
      /masks changed: 1 added \(\[data-volatile="relative time"\]\): review the masks, then name it in --allow-masks/
    );
    r = await person(f, [...plan, '--allow-masks', id]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    e = planOf(P.store.reports);
    assert.equal(e.status, 'ok');
    assert.deepEqual(e.masks, CHANGED);
    assert.match(e.why, /^allowed by name: masks changed/);

    // apply: the line says it was a masks change, and what changed; no identity.
    const S = await serve(f);
    try {
      r = await person(f, ['apply'], { input: 'APPROVE 1 ENTRIES\n', url: S.base });
    } finally {
      await S.stop();
    }
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}\n${S.log()}`);
    assert.match(r.stdout, /1 masks changes allowed by name/);
    const line = readLog(P).find((l) => l.id === id);
    assert.equal(line?.kind, 'masks');
    assert.deepEqual(line?.masks, CHANGED);
    assert.ok(!('by' in (line ?? {})) && !JSON.stringify(line).includes('@'), 'names no one');
  }
);

test('plan and the server: masks no approval passes stay blocked', { skip }, async (t) => {
  // Owner decision 2: over 50% of the capture, or on the story root, no approval passes.
  const { f, P, id } = store(t, {
    pass: false,
    masksBlocked: { coverage: 0.62, root: ['#storybook-root > *'] },
    reasons: [
      'masks cover 62% of the capture, over 50%',
      'a mask covers the story root: #storybook-root > *',
    ],
  });
  const r = await person(f, [
    'plan',
    id,
    '--reason',
    REASON,
    '--allow-shape',
    id,
    '--allow-masks',
    id,
  ]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const e = planOf(P.store.reports);
  assert.equal(e.status, 'blocked');
  assert.equal(
    e.why,
    'masks cover 62% of the capture, over 50%; a mask covers the story root: #storybook-root > *: no approval passes it until the masks are smaller'
  );
  // The server's approve refuses it before anything is written, whoever asks.
  const S = await serve(f);
  try {
    const res = await S.post('approve', { id });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(String(res.body.error), /no approval passes it until the masks are smaller/);
  } finally {
    await S.stop();
  }
  assert.equal(readLog(P).length, 0);
});

test('Approve story leaves out an entry whose masks changed, and one no approval passes', () => {
  const row = /** @type {CheckRow} */ ({ id: 'a--b', pass: false });
  assert.equal(storySkip(undefined, row), null);
  assert.equal(
    storySkip(undefined, { ...row, masksChanged: CHANGED }),
    'masks changed: approve it on its own'
  );
  assert.equal(
    storySkip(undefined, { ...row, masksBlocked: { coverage: 0.9 } }),
    'masks no approval passes'
  );
});
