/**
 * batch-shape.test.mjs — the batch name a decision is logged under (`batch` in approvals.ndjson and
 * a11y-decisions.ndjson): the names pxsig itself makes (`newBatch`, an undo's `-undo`), and what
 * the server does with a `batch` a request sends (POST /__pxsig/approve, /__pxsig/a11y-prune): it
 * keeps pxsig's own shape (`BATCH_RE`) and names any other batch itself, so a client cannot log
 * free text.
 *
 *   node --test packages/pxsig/test/batch-shape.test.mjs
 *
 * The server tests need the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BATCH_RE, migrateBatch, newBatch, ownBatch } from '../src/lib/approvals.mjs';
import { readToken } from '../src/lib/guard.mjs';
import { buildPlan } from '../src/lib/prune.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hasRust, rustBin, testEnv, testHome } from './fixture.mjs';
import { startServer } from './server-proc.mjs';
import { skipUnless } from './strict.mjs';

const SHAPE = BATCH_RE;
const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

test("pxsig's own batch names: newBatch for every way in, and an undo's -undo", () => {
  // Every `newBatch(...)` in src/: the CLI's apply, adopt, check --update, a11y --prune, and the
  // server's fallback with the request's `via` (lib/guard.mjs: dashboard, cli, mcp).
  for (const via of ['cli', 'adopt', 'check-update', 'prune', 'dashboard', 'mcp']) {
    const b = newBatch(via);
    assert.match(b, SHAPE, b);
    assert.ok(b.endsWith(`-${via}`), b);
    // `approve undo <batch>` (approve.mjs) and the dashboard's undo (serve/review.mjs).
    assert.match(`${b}-undo`, SHAPE);
    assert.match(`${b}-undo-undo`, SHAPE);
    assert.equal(ownBatch(b), b);
  }
  // `pxsig migrate` (lib/setup/migrate.mjs), and its undo.
  const m = migrateBatch(new Date().toISOString());
  assert.match(m, SHAPE, m);
  assert.match(`${m}-undo`, SHAPE);
});

test('every newBatch in src/ names a way in BATCH_RE knows', () => {
  /** @param {string} dir @returns {string[]} */
  const files = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory()
        ? files(join(dir, d.name))
        : d.name.endsWith('.mjs')
          ? [join(dir, d.name)]
          : []
    );
  const vias = files(src).flatMap((f) =>
    [...readFileSync(f, 'utf8').matchAll(/newBatch\('([^']+)'\)/g)].map((m) => m[1])
  );
  assert.ok(vias.length >= 5, vias.join());
  for (const via of vias) assert.match(newBatch(via), SHAPE, via);
});

test('ownBatch keeps only a batch name pxsig made', () => {
  for (const v of [
    'my release: v2!',
    'myreleasev2',
    'b-srv',
    '',
    `${newBatch('cli')} `,
    `x${newBatch('cli')}`,
    newBatch('someone'),
    newBatch('cli').replace('Z-', 'Z-cli-'),
    `${newBatch('cli')}${'-undo'.repeat(12)}`,
    `migrate-${newBatch('cli')}`,
    42,
    null,
    undefined,
    ['x'],
  ])
    assert.equal(ownBatch(v), null, String(v));
});

/**
 * @param {ReturnType<typeof fixture>} f
 * @param {string} file
 */
const lines = (f, file) =>
  readFileSync(join(f.px, file), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

/**
 * Start a server on the fixture; `post(action, body)` sends a decision with the CLI's token.
 * @param {ReturnType<typeof fixture>} f
 */
async function serve(f) {
  const S = await startServer({
    cwd: f.repo,
    env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' },
  });
  const url = `http://127.0.0.1:${S.port}`;
  /**
   * @param {string} action
   * @param {Record<string, unknown>} body
   */
  const post = async (action, body) => {
    const r = await fetch(`${url}/__pxsig/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The server wrote its token when it started.
        'x-pxsig-token': /** @type {string} */ (readToken(f.repo, url)),
      },
      body: JSON.stringify({ project: 'fixture', ...body }),
    });
    // The server's answer (docs/server.md): a decision's `entry`, a prune's `batch`.
    const answer = /** @type {{ entry: { batch: string }, batch: string }} */ (await r.json());
    return { status: r.status, body: answer };
  };
  return { post, stop: () => S.stop() };
}

test(
  "the approve route: pxsig's own batch is kept; none, or free text, gets the server's",
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const S = await serve(f);
    try {
      // `pxsig approve apply` posts one batch for every entry of its plan (approve.mjs).
      const cli = newBatch('cli');
      const kept = await S.post('approve', { id: f.ids.changed, batch: cli, via: 'cli' });
      assert.equal(kept.status, 200, JSON.stringify(kept.body));
      assert.equal(kept.body.entry.batch, cli, 'the answer carries the batch');
      assert.equal(lines(f, 'approvals.ndjson').at(-1).batch, cli);

      // The dashboard and the Storybook panel send no batch: the server names it.
      const none = await S.post('approve', { id: f.ids.a11y });
      assert.equal(none.status, 200, JSON.stringify(none.body));
      assert.match(none.body.entry.batch, SHAPE);
      assert.ok(none.body.entry.batch.endsWith('-cli'), 'named after how it came (the token)');

      // Free text is never logged: the server names the batch, and the answer says which.
      const free = await S.post('approve', { id: f.ids.drift, batch: 'my release: v2!' });
      assert.equal(free.status, 200, JSON.stringify(free.body));
      assert.match(free.body.entry.batch, SHAPE);
      assert.ok(free.body.entry.batch.endsWith('-cli'));
      assert.equal(lines(f, 'approvals.ndjson').at(-1).batch, free.body.entry.batch);
    } finally {
      await S.stop();
    }
  }
);

test(
  "the a11y-prune route: pxsig's own batch is kept, free text gets the server's",
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture({ withSigs: false });
    writeFileSync(
      join(f.px, 'a11y.json'),
      JSON.stringify({ [f.ids.ok]: ['region'], [f.ids.a11y]: ['label'] })
    );
    const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
    const S = await serve(f);
    try {
      /** One rule at a time, each plan pinned to the a11y.json the last prune left. */
      const prune = async (/** @type {unknown} */ batch) => {
        const plan = buildPlan(P, {
          stale: () => ({ ids: new Map(), unknown: null }),
          modeOf: () => 'dark',
        });
        return S.post('a11y-prune', {
          plan: { a11ySha: plan.a11ySha, prune: plan.prune.slice(0, 1) },
          batch,
        });
      };
      // `pxsig a11y --prune` posts newBatch('prune') (cli/a11y-prune.mjs).
      const own = newBatch('prune');
      const kept = await prune(own);
      assert.equal(kept.status, 200, JSON.stringify(kept.body));
      assert.equal(kept.body.batch, own, 'the answer carries the batch');
      assert.equal(lines(f, 'a11y-decisions.ndjson').at(-1).batch, own);

      const free = await prune('ticket 42: tidy');
      assert.equal(free.status, 200, JSON.stringify(free.body));
      assert.match(free.body.batch, SHAPE);
      assert.ok(free.body.batch.endsWith('-prune'));
      assert.equal(lines(f, 'a11y-decisions.ndjson').at(-1).batch, free.body.batch);
    } finally {
      await S.stop();
    }
  }
);
