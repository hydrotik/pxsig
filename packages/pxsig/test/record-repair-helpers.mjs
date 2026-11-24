/**
 * record-repair-helpers.mjs — the stores the record-repair tests share: the fixture with entries
 * made as the old `pxsig migrate` made them (a record from one render, the latest render as its
 * image, a migrate line).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../src/lib/approvals.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { CHECKER, fixture, png, rustBin } from './fixture.mjs';

/** @import { Manifest } from '../src/types.js' */

/** CHECKER with one pixel changed: another render, within the gate. */
export const DOT = png(128, 128, (x, y) =>
  x === 0 && y === 0 ? [255, 0, 255] : ((x >> 4) + (y >> 4)) % 2 ? [230, 230, 230] : [40, 60, 90]
);
/** CHECKER with a red block: another render, outside the gate. */
export const FAR = png(128, 128, (x, y) =>
  x > 16 && x < 112 && y > 16 && y < 112
    ? [220, 20, 20]
    : ((x >> 4) + (y >> 4)) % 2
      ? [230, 230, 230]
      : [40, 60, 90]
);

/**
 * The fixture with `entries` made as the old `pxsig migrate` made them: a record captured from one
 * render, packed with the latest render as its image, and logged by migrate.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, { record: Buffer, latest?: Buffer, also?: object[] }>} entries
 */
export function store(t, entries) {
  const f = fixture({ t });
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
  const tmp = join(f.repo, '.tmp');
  mkdirSync(tmp, { recursive: true });
  const lines = [];
  for (const [id, x] of Object.entries(entries)) {
    writeFileSync(join(tmp, `${id}.record.png`), x.record);
    const rec = join(tmp, `${id}.pxsig.json`);
    let r = spawnSync(
      rustBin,
      ['capture', join(tmp, `${id}.record.png`), '--out', rec, '--grid', '16'],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
    const image = join(tmp, `${id}.image.png`);
    writeFileSync(image, CHECKER);
    r = spawnSync(
      rustBin,
      ['pack', rec, '--out', f.sig(id), '--image', image, '--entry', JSON.stringify({ id })],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
    writeFileSync(f.latest(id), x.latest ?? CHECKER);
    lines.push({
      at: '2026-11-01T00:00:00.000Z',
      id,
      via: 'migrate',
      batch: 'migrate-2026-11-01T00-00-00-000Z',
      kind: null,
      before: null,
      after: sha256(f.sig(id)),
      pxsig: '0.7.6',
    });
    for (const l of x.also ?? []) lines.push({ id, after: sha256(f.sig(id)), ...l });
  }
  writeFileSync(P.store.approvals, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  /** @type {Manifest} */
  const manifest = JSON.parse(readFileSync(P.manifestPath(), 'utf8'));
  return { f, P, manifest };
}

/** The fixture's id for a name (fixture().ids), known before the fixture exists. */
export function f0(/** @type {string} */ name) {
  return /** @type {Record<string, string>} */ ({
    ok: 'components-alpha--default',
    drift: 'components-alpha--with-icon',
    changed: 'components-beta--default',
    flaky: 'components-beta--flaky',
  })[name];
}
