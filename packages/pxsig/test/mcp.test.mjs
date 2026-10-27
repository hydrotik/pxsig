/**
 * mcp.test.mjs — the MCP server over its real transport (stdio JSON-RPC).
 *
 *   node --test packages/pxsig/test/mcp.test.mjs
 *
 * Runs in a fixture project. PXSIG_URL points at a closed port, so the "server down" paths are
 * exercised and nothing here can render, check or write a baseline.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { fixture, rustBin } from './fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { repo } = fixture({ withSigs: false });

let proc;
const pending = new Map();
let seq = 0;
const rpc = (method, params) =>
  new Promise((ok) => {
    const id = ++seq;
    pending.set(id, ok);
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
const call = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result;
const json = (result) => JSON.parse(result.content[0].text);

before(() => {
  proc = spawn(process.execPath, [join(here, '..', 'src', 'mcp.mjs')], {
    cwd: repo,
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, PXSIG_URL: 'http://127.0.0.1:1', PXSIG_BIN: rustBin },
  });
  createInterface({ input: proc.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
});
after(() => proc.kill());

test('initialize echoes the protocol version and declares tools', async () => {
  const res = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  });
  assert.equal(res.result.protocolVersion, '2025-06-18');
  assert.ok(res.result.capabilities.tools);
  assert.equal(res.result.serverInfo.name, 'pxsig');
  assert.match(
    res.result.instructions,
    /never approve, never accept, and never call `\/__pxsig\/approve`; ask the person to review in the dashboard/
  );
});

test('notifications get no reply; ping does', async () => {
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const res = await rpc('ping', {});
  assert.deepEqual(res.result, {});
});

test('tools/list exposes every tool with a JSON schema and no handler', async () => {
  const { result } = await rpc('tools/list', {});
  const names = result.tools.map((t) => t.name);
  for (const n of [
    'pxsig_projects',
    'pxsig_status',
    'pxsig_list',
    'pxsig_entry',
    'pxsig_a11y',
    'pxsig_affected',
    'pxsig_check',
    'pxsig_review',
    'pxsig_history',
    'pxsig_doctor',
    'pxsig_help',
  ])
    assert.ok(names.includes(n), n);
  for (const t of result.tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.run, undefined);
  }
});

test('unknown tool and unknown method are errors', async () => {
  const a = await rpc('tools/call', { name: 'nope', arguments: {} });
  assert.equal(a.error.code, -32602);
  const b = await rpc('resources/list', {});
  assert.equal(b.error.code, -32601);
});

test('review refuses without confirm: true, before touching the server', async () => {
  const r = await call('pxsig_review', {
    action: 'reject',
    ids: ['components-button--default'],
    confirm: false,
  });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /confirm: true/);
});

test("review offers rejections only: approving and accepting are a person's, even with confirm", async () => {
  const list = await rpc('tools/list', {});
  const tool = list.result.tools.find((x) => x.name === 'pxsig_review');
  assert.deepEqual(tool.inputSchema.properties.action.enum, [
    'reject',
    'unreview',
    'a11y-reject',
    'a11y-unreview',
  ]);
  for (const action of ['approve', 'a11y-accept', 'a11y-unaccept']) {
    const r = await call('pxsig_review', {
      action,
      ids: ['components-button--default'],
      confirm: true,
    });
    assert.equal(r.isError, true, action);
    assert.match(r.content[0].text, /not an agent's decision.*needs a person/, action);
  }
  const r = await call('pxsig_review', {
    action: 'a11y-reject',
    ids: ['components-button--default'],
    confirm: false,
  });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /confirm: true/);
});

test('review with confirm still needs the server', async () => {
  const r = await call('pxsig_review', {
    action: 'reject',
    ids: ['components-button--default'],
    confirm: true,
  });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not running/);
});

test('entry rejects a malformed id', async () => {
  const r = await call('pxsig_entry', { id: '../../etc/passwd' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /bad id/);
});

test('status reports the server as down and counts every entry', async () => {
  const s = json(await call('pxsig_status'));
  assert.equal(s.server.up, false);
  const total = Object.values(s.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, s.entries);
  assert.deepEqual(s.approvals, { level: 'standard' });
});

test('list filters by state and component', async () => {
  const all = json(await call('pxsig_list', { state: 'all', limit: 5000 }));
  const beta = json(await call('pxsig_list', { state: 'all', component: 'beta', limit: 5000 }));
  assert.ok(beta.total > 0 && beta.total < all.total);
  assert.ok(beta.entries.every((e) => e.id.includes('beta')));
});

test('entry returns text then inline PNGs', async () => {
  const id = 'components-alpha--default';
  const r = await call('pxsig_entry', { id, images: ['current'] });
  assert.equal(r.isError, undefined);
  assert.equal(json({ content: [r.content[0]] }).id, id);
  const img = r.content.find((c) => c.type === 'image');
  if (img) assert.equal(Buffer.from(img.data, 'base64').subarray(1, 4).toString(), 'PNG');
});

test('projects lists the workspace; an unknown project is an error naming the projects', async () => {
  const p = json(await call('pxsig_projects'));
  assert.deepEqual(
    p.projects.map((x) => x.name),
    ['fixture']
  );
  const r = await call('pxsig_status', { project: 'nope' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /projects: fixture/);
});

test('doctor repair apply takes the store lock: a store another process holds is refused, unchanged', async () => {
  const lock = join(repo, '.pxsig', 'reports', '.lock');
  const manifest = join(repo, '.pxsig', 'manifest.json');
  const before = readFileSync(manifest, 'utf8');
  writeFileSync(
    lock,
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), holder: 'check', command: 'pxsig check --full' })}\n`
  );
  try {
    const r = await call('pxsig_doctor', { repair: 'apply', offline: true });
    assert.equal(r.isError, true);
    assert.match(
      r.content[0].text,
      /`pxsig check --full` \(pid \d+, since .+\) holds the store .+: the repair did not run/
    );
    assert.equal(readFileSync(manifest, 'utf8'), before);
  } finally {
    rmSync(lock, { force: true });
  }
  // Free again: the plan still runs without the lock (it writes only the ledger).
  const plan = json(await call('pxsig_doctor', { repair: 'plan', offline: true }));
  assert.ok(Array.isArray(plan.plan.steps));
});

test('pxsig_a11y prune_plan lists accepted rules by class and writes nothing', async () => {
  const a11y = join(repo, '.pxsig', 'a11y.json');
  const before = readFileSync(a11y, 'utf8');
  writeFileSync(
    a11y,
    JSON.stringify({
      'components-alpha--default': ['region'],
      'components-delta--a-11-y': ['color-contrast'],
    })
  );
  try {
    const r = json(await call('pxsig_a11y', { prune_plan: true }));
    assert.deepEqual(r.counts, { prunable: 1, 'still-fires': 1, stale: 0, 'not-covered': 0 });
    assert.deepEqual(
      r.prunable.map((p) => [p.id, p.rules]),
      [['components-alpha--default', ['region']]]
    );
    assert.match(r.hint, /a person removes these with `pxsig a11y --prune` in a terminal/);
    assert.equal(
      readFileSync(a11y, 'utf8'),
      JSON.stringify({
        'components-alpha--default': ['region'],
        'components-delta--a-11-y': ['color-contrast'],
      })
    );
  } finally {
    writeFileSync(a11y, before);
  }
});
