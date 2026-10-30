// The approval tollgate: the shape classifier, and the refusals that keep bulk baseline writes
// in a person's hands. Synthetic images and a fixture project; needs no server or Storybook.
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { detectAgent } from '../src/lib/agents.mjs';
import { paths, readLog, record, sha256, snapshot, undo, verify } from '../src/lib/approvals.mjs';
import { classify } from '../src/lib/shape.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hashTree, hasRust, png, rustBin, testEnv, testHome } from './fixture.mjs';
import { skipUnless } from './strict.mjs';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const { repo, sig } = fixture({ withSigs: hasRust });
/**
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
const node = (args, env = {}) =>
  spawnSync(process.execPath, args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...testEnv(testHome), PXSIG_URL: 'http://127.0.0.1:1', PXSIG_BIN: rustBin, ...env },
  });

// A light page with a dark "thumb" at x0, and the same thumb moved, recoloured, or on a bigger page.
/**
 * @param {number} w
 * @param {number} h
 * @param {number} x0
 * @param {number[]} [ink]
 */
const page = (w, h, x0, ink = [30, 40, 60]) =>
  png(w, h, (x, y) => (x >= x0 && x < x0 + 24 && y >= 20 && y < 44 ? ink : [245, 245, 245]));
const OFF = page(96, 64, 12);
const ON = page(96, 64, 60);
const RECOLOURED = page(96, 64, 12, [60, 30, 40]);
const WIDE = page(160, 64, 12);

test('identical renders are colour-only', () => {
  assert.equal(classify(OFF, OFF).kind, 'colour');
});

test('a recolour with content in place is colour-only', () => {
  assert.equal(classify(OFF, RECOLOURED).kind, 'colour');
});

test('a moved element (switch thumb off → on) is a shape change', () => {
  assert.equal(classify(OFF, ON).kind, 'shape');
});

test('a size change is a shape change', () => {
  const r = classify(OFF, WIDE);
  assert.equal(r.kind, 'shape');
  assert.match(r.reason, /size/);
});

test('approve apply / undo / verify --adopt refuse without a person at a terminal (exit 3)', () => {
  for (const args of [
    ['approve', 'apply'],
    ['approve', 'undo', 'x'],
    ['approve', 'verify', '--adopt'],
  ]) {
    const r = node([join(src, 'cli.mjs'), ...args]);
    assert.equal(r.status, 3, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /needs a person at a terminal/);
  }
});

test('approve plan needs a reason', () => {
  const r = node([join(src, 'cli.mjs'), 'approve', 'plan', '--all-changed']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--reason/);
});

test('check --update refuses before rendering when piped: exit 3, as every person-only command', () => {
  const r = node([join(src, 'check.mjs'), '--update', '--only', 'components-alpha--default']);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /without review/);
});

test('check --kind and --reason go with --update; a kind is one short word', () => {
  let r = node([join(src, 'check.mjs'), '--kind', 'environment']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /go with --update/);
  r = node([join(src, 'check.mjs'), '--update', '--kind', 'Not A Kind']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--kind takes a short lower-case word/);
});

test(
  'snapshot + record + undo round-trip, and verify catches an out-of-band write',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  () => {
    const P = openProject({ cwd: repo, env: { PXSIG_BIN: rustBin } });
    const id = 'components-alpha--default';
    const entry = { id, sig: `.pxsig/baselines/components/Alpha/${id}.psig` };
    const manifest = { stories: [entry] };
    const original = readFileSync(sig(id));
    // approve: snapshot the old baseline, write the new one, log it
    const { before } = snapshot(P, entry, 'b1');
    copyFileSync(sig('components-alpha--with-icon'), sig(id));
    record(P, entry, { batch: 'b1', via: 'test', before });
    assert.equal(readLog(P).length, 1);
    assert.deepEqual(verify(P, manifest).mismatched, []);
    // a write outside the trail is caught
    writeFileSync(sig(id), Buffer.concat([readFileSync(sig(id)), Buffer.from([0])]));
    assert.equal(verify(P, manifest).mismatched.length, 1);
    // undo restores the pre-approval baseline, byte for byte
    assert.deepEqual(undo(P, manifest, 'b1').restored, [id]);
    assert.deepEqual(readFileSync(sig(id)), original);
    assert.ok(existsSync(join(P.store.history, 'b1', `${id}.psig`)));
  }
);

test(
  'undo refuses a batch whose baseline was approved again later, until that batch is undone',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const P = openProject({ cwd: repo, env: { PXSIG_BIN: rustBin } });
    const id = 'components-alpha--default';
    const entry = { id, sig: `.pxsig/baselines/components/Alpha/${id}.psig` };
    const manifest = { stories: [entry] };
    const original = readFileSync(sig(id));
    /** @param {string} batch @param {Buffer} bytes */
    const approve = (batch, bytes) => {
      const { before } = snapshot(P, entry, batch);
      writeFileSync(sig(id), bytes);
      record(P, entry, { batch, via: 'test', before });
    };
    const first = readFileSync(sig('components-alpha--with-icon'));
    approve('c1', first);
    approve('c2', Buffer.concat([first, Buffer.from([1])]));
    // Undoing c1 now would silently revert c2's approval: refused, nothing written.
    const r = undo(P, manifest, 'c1');
    assert.deepEqual(r.restored, []);
    assert.match(r.refused[0]?.why ?? '', /approved again in batch c2 after this one/);
    assert.equal(sha256(sig(id)), readLog(P).at(-1)?.after);
    // Once c2 is undone (and logged), c1 can be.
    assert.deepEqual(undo(P, manifest, 'c2').restored, [id]);
    record(P, entry, { batch: 'c2-undo', via: 'test', before: readLog(P).at(-1)?.after });
    assert.deepEqual(undo(P, manifest, 'c1').restored, [id]);
    assert.deepEqual(readFileSync(sig(id)), original);
  }
);

test('approve apply refuses a plan naming an entry the manifest no longer has, writing nothing', () => {
  const P = openProject({ cwd: repo, env: { PXSIG_BIN: rustBin } });
  const real = {
    id: 'components-alpha--default',
    sig: `.pxsig/baselines/components/Alpha/components-alpha--default.psig`,
  };
  const p = paths(P, real);
  const plan = {
    version: 1,
    createdAt: new Date().toISOString(),
    project: P.name,
    reason: 'a plan made before the story was removed',
    entries: [
      {
        id: real.id,
        status: 'ok',
        why: '',
        kind: 'colour',
        latestSha: sha256(p.latestPng),
        baseSha: sha256(p.sig),
      },
      {
        id: 'components-gone--default',
        status: 'ok',
        why: '',
        kind: 'colour',
        latestSha: 'x',
        baseSha: 'x',
      },
    ],
  };
  mkdirSync(P.store.reports, { recursive: true });
  const planFile = join(P.store.reports, 'stale-plan.json');
  writeFileSync(planFile, JSON.stringify(plan));
  // A person at a terminal: TTYs (a preload, as a file URL for Windows), no CI and no assistant markers.
  const preload = join(repo, 'tty-preload.mjs');
  writeFileSync(preload, 'process.stdin.isTTY = true;\nprocess.stdout.isTTY = true;\n');
  /** @type {Record<string, string | undefined>} */
  const env = {
    ...testEnv(testHome),
    PXSIG_URL: 'http://127.0.0.1:1',
    PXSIG_BIN: rustBin,
    PXSIG_FORMAT: 'plain',
  };
  delete env.CI;
  for (let a = detectAgent(env); a; a = detectAgent(env)) delete env[a.variable];
  const before = { store: hashTree(P.store.root), log: readLog(P).length };
  const r = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(preload).href, join(src, 'cli.mjs'), 'approve', 'apply', planFile],
    {
      cwd: repo,
      encoding: 'utf8',
      input: '',
      timeout: 20_000,
      env,
    }
  );
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(
    r.stderr,
    /1 planned entries are no longer in the manifest: components-gone--default: plan again/
  );
  assert.doesNotMatch(r.stderr, /TypeError/);
  assert.equal(hashTree(P.store.root), before.store, 'nothing in the store changed');
  assert.equal(readLog(P).length, before.log, 'no approval log line');
});
