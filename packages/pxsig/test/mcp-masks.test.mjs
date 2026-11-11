/**
 * mcp-masks.test.mjs — masks where agents read them (volatile content PR 3): MCP `pxsig_list`
 * (the brief: `masksChanged`, `masksLarge`) and `pxsig_entry` (`masks`, `masksBaseline`,
 * `maskWarnings`), from a fixture project whose check.json rows carry the engine's mask fields.
 * No server.
 *
 *   node --test packages/pxsig/test/mcp-masks.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fixture, rustBin, testEnv, testHome } from './fixture.mjs';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const CHANGED = 'components-beta--default';
const PASSING = 'components-alpha--default';

const CLOCK = {
  selector: '[data-volatile="relative time"]',
  source: 'attribute',
  reason: 'relative time',
};
const { repo } = fixture({ withSigs: false });
{
  const file = join(repo, '.pxsig/reports/check.json');
  const report = JSON.parse(readFileSync(file, 'utf8'));
  for (const r of report.rows) {
    if (r.id === CHANGED)
      Object.assign(r, {
        masks: [
          { ...CLOCK, area: 0.62 },
          { selector: '.stamp', source: 'project', area: 0.04 },
        ],
        masksLarge: [{ selector: CLOCK.selector, source: 'attribute', area: 0.62 }],
        masksChanged: { added: ['.stamp'], removed: [], grew: [CLOCK.selector] },
        masksBaseline: [{ ...CLOCK, area: 0.1 }],
      });
    if (r.id === PASSING) r.masks = [{ ...CLOCK, area: 0.05 }];
  }
  writeFileSync(file, JSON.stringify(report));
}

/**
 * @param {string} tool
 * @param {Record<string, unknown>} args
 */
const mcp = (tool, args) => {
  const r = spawnSync(process.execPath, [join(src, 'mcp-call.mjs'), tool, JSON.stringify(args)], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...testEnv(testHome), PXSIG_URL: 'http://127.0.0.1:1', PXSIG_BIN: rustBin },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('pxsig_list: the brief carries a mask change and the large masks, nothing else', () => {
  const all = mcp('pxsig_list', { state: 'all', limit: 500 }).entries;
  const changed = all.find((/** @type {{ id: string }} */ e) => e.id === CHANGED);
  assert.deepEqual(changed.masksChanged, {
    added: ['.stamp'],
    removed: [],
    grew: [CLOCK.selector],
  });
  assert.deepEqual(changed.masksLarge, [
    { selector: CLOCK.selector, source: 'attribute', area: 0.62 },
  ]);
  assert.ok(!('masks' in changed), 'the full list is pxsig_entry’s');
  const passing = all.find((/** @type {{ id: string }} */ e) => e.id === PASSING);
  assert.ok(!('masksChanged' in passing) && !('masksLarge' in passing), JSON.stringify(passing));
});

test('pxsig_entry: the masks in full, the baseline’s beside a change, the warning as a sentence', () => {
  const e = mcp('pxsig_entry', { id: CHANGED, images: [] });
  assert.deepEqual(
    e.masks.map(
      (/** @type {{ selector: string, source: string, reason?: string, area: number }} */ m) => [
        m.selector,
        m.source,
        m.reason ?? null,
        m.area,
      ]
    ),
    [
      [CLOCK.selector, 'attribute', 'relative time', 0.62],
      ['.stamp', 'project', null, 0.04],
    ]
  );
  assert.deepEqual(e.masksBaseline, [{ ...CLOCK, area: 0.1 }]);
  assert.deepEqual(e.maskWarnings, [
    `${CLOCK.selector} (attribute) covers 62% of the capture, over 25%: changes under it are not compared`,
  ]);
  const p = mcp('pxsig_entry', { id: PASSING, images: [] });
  assert.equal(p.masks[0].area, 0.05);
  assert.ok(!('masksBaseline' in p) && !('maskWarnings' in p), JSON.stringify(p));
  const plain = mcp('pxsig_entry', { id: 'components-alpha--with-icon', images: [] });
  assert.ok(!('masks' in plain), 'no masks, no key');
});
