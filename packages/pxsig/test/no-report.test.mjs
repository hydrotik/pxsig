/**
 * no-report.test.mjs — before the first full check, the "no report" error names the next step for
 * the surface that printed it: `pxsig check --full` in the CLI, `pxsig_check` over MCP, and
 * `pxsig manifest` first when there is no manifest (tools/context.mjs `noReport`).
 *
 *   node --test packages/pxsig/test/no-report.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tools } from '../src/tools/index.mjs';
import { fixture, testEnv, testHome } from './fixture.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pxsig.mjs');

/** @param {string} repo */
const cliList = (repo) =>
  spawnSync(process.execPath, [cli, 'list', '--plain'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...testEnv(testHome), PXSIG_WORKSPACE: '', PXSIG_NO_DELEGATE: '1' },
  });

/** @param {string} repo */
async function mcpList(repo) {
  const before = process.env.PXSIG_WORKSPACE;
  process.env.PXSIG_WORKSPACE = repo;
  try {
    const list = /** @type {{ run: (a: object) => Promise<unknown> }} */ (
      tools.find((t) => t.name === 'pxsig_list')
    );
    return await list.run({}).then(
      () => '',
      (/** @type {Error} */ e) => e.message
    );
  } finally {
    if (before === undefined) delete process.env.PXSIG_WORKSPACE;
    else process.env.PXSIG_WORKSPACE = before;
  }
}

test('no report: the CLI names `pxsig check --full`, MCP names pxsig_check', async (t) => {
  const f = fixture({ t });
  rmSync(join(f.px, 'reports', 'check.json'));
  const r = cliList(f.repo);
  assert.match(r.stdout + r.stderr, /no report at .*check\.json: run `pxsig check --full`/);
  assert.doesNotMatch(r.stdout + r.stderr, /pxsig_check/);
  assert.match(await mcpList(f.repo), /no report at .*: pxsig_check with all: true runs one/);
});

test('no manifest either: `pxsig manifest` comes first, on both surfaces', async (t) => {
  const f = fixture({ t });
  rmSync(join(f.px, 'reports', 'check.json'));
  rmSync(join(f.px, 'manifest.json'));
  const r = cliList(f.repo);
  assert.match(
    r.stdout + r.stderr,
    /no manifest yet: run `pxsig manifest`, then `pxsig check --full`/
  );
  assert.match(
    await mcpList(f.repo),
    /no manifest yet: run `pxsig manifest`, then `pxsig check --full`, in a terminal/
  );
});
