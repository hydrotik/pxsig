/**
 * rejection-packet-files.test.mjs — lib/rejections/packet.mjs on a fixture store, with the engine's
 * `diff`: the packet a rejection gets (files, crops, rejection.json and .md with no absolute path,
 * home or temp folder), its refresh, the a11y packet, no packet while reports/ is not ignored or
 * with `rejections.packet: false`, removal when the rejection closes, and the sweep.
 *
 *   node --test packages/pxsig/test/rejection-packet-files.test.mjs
 *
 * Needs the Rust binary.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  afterCheck,
  closeRejection,
  openRejection,
  readRejections,
  sweepPackets,
} from '../src/lib/rejections.mjs';
import { engineDiff, NOT_IGNORED, packetFor } from '../src/lib/rejections/packet.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { BROKEN, fixture, hasRust, rustBin } from './fixture.mjs';
import { skipUnless } from './strict.mjs';

const rust = skipUnless(hasRust, 'Rust binary not built');
const NOTE = 'the red block should not be there';

/** @param {ReturnType<typeof fixture>} f */
const projectOf = (f) =>
  openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });

/**
 * Every text file of a folder, recursively.
 * @param {string} dir
 * @returns {string[]}
 */
const texts = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? texts(join(dir, d.name))
      : /\.(md|json)$/.test(d.name)
        ? [readFileSync(join(dir, d.name), 'utf8')]
        : []
  );

test(
  'a rejection gets its packet: images, crops, rejection.md and .json, no path',
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    const P = projectOf(f);
    const id = f.ids.changed;
    writeFileSync(f.latest(id), BROKEN);
    openRejection(P, 'visual', id, { via: 'dashboard', note: NOTE });
    const diff = engineDiff(rustBin);
    const { record, error } = await packetFor(P, 'visual', id, { diff, ignored: true });
    assert.equal(error, null);
    assert.equal(record?.packet, `reports/rejected/${id}/`);
    assert.equal(readRejections(P).visual[id].packet, `reports/rejected/${id}/`);
    const dir = join(f.px, 'reports', 'rejected', id);
    assert.deepEqual(readdirSync(dir).sort(), [
      'baseline.png',
      'crops',
      'current.png',
      'mask.png',
      'rejection.json',
      'rejection.md',
    ]);
    assert.deepEqual(readdirSync(join(dir, 'crops')).sort(), [
      '1.baseline.png',
      '1.current.png',
      '1.diff.png',
    ]);
    const facts = JSON.parse(readFileSync(join(dir, 'rejection.json'), 'utf8'));
    assert.equal(facts.note, NOTE);
    assert.equal(facts.packet, `reports/rejected/${id}/`);
    assert.equal(facts.store, '.pxsig');
    assert.equal(facts.baseline, `.pxsig/baselines/components/Beta/${id}.psig`);
    assert.equal(facts.next, `pxsig check ${id}`);
    // BROKEN is CHECKER with a red square at 25..103: one region (8px tiles), padded by 24 and clamped to the image.
    assert.equal(facts.regions.length, 1);
    assert.deepEqual(
      [facts.regions[0].x, facts.regions[0].y, facts.regions[0].w, facts.regions[0].h],
      [0, 0, 128, 128]
    );
    assert.ok(facts.metrics.changedPx > 6000);
    assert.match(facts.prompt, new RegExp(`^pxsig rejected ${id} \\(fixture\\): "${NOTE}"\\.`));
    const md = readFileSync(join(dir, 'rejection.md'), 'utf8');
    assert.ok(md.includes(`\`\`\`text\n${NOTE}\n\`\`\``));
    assert.ok(md.includes('crops/1.baseline.png · crops/1.current.png · crops/1.diff.png'));
    for (const text of texts(dir))
      for (const p of [f.repo, homedir(), tmpdir(), f.repo.replaceAll('\\', '/')])
        assert.ok(!text.includes(p), 'no absolute path in the packet');
    assert.ok(!readdirSync(join(f.px, 'reports', 'rejected')).some((n) => n.includes('.tmp')));

    // A check that still differs: the record gains it and the packet is refreshed.
    const rows = [{ id, pass: false, metrics: { ssim: 0.7 }, reasons: ['ssim 0.7 < min 0.99'] }];
    const after = afterCheck(P, rows);
    assert.equal(after.checked.length, 1);
    await packetFor(P, 'visual', id, { diff, ignored: true, row: rows[0] });
    const again = JSON.parse(readFileSync(join(dir, 'rejection.json'), 'utf8'));
    assert.deepEqual(
      [again.checks.length, again.metrics.ssim, again.metrics.gate],
      [1, 0.7, rows[0].reasons]
    );

    // A pass closes the rejection and removes its packet; the reason stays in the log.
    afterCheck(P, [{ id, pass: true, metrics: { ssim: 1 } }]);
    assert.ok(!existsSync(dir));
    assert.ok(readFileSync(join(f.px, 'reports', 'rejections.ndjson'), 'utf8').includes(NOTE));
  }
);

test(
  'an a11y packet: rejection.md with the new violations, current.png, no crops',
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    const P = projectOf(f);
    const id = f.ids.a11y;
    openRejection(P, 'a11y', id, { via: 'mcp', note: 'contrast' });
    const { record } = await packetFor(P, 'a11y', id, { diff: engineDiff(rustBin), ignored: true });
    assert.equal(record?.packet, `reports/rejected/${id}.a11y/`);
    const dir = join(f.px, 'reports', 'rejected', `${id}.a11y`);
    assert.deepEqual(readdirSync(dir).sort(), ['current.png', 'rejection.json', 'rejection.md']);
    const md = readFileSync(join(dir, 'rejection.md'), 'utf8');
    assert.ok(md.includes('- Goal: fix the violations.'));
    assert.ok(md.includes("through mcp, an assistant at the person's request"));
    assert.ok(md.includes('| color-contrast |'));
    closeRejection(P, 'a11y', id, 'undone');
    assert.ok(!existsSync(dir));
  }
);

test(
  'no packet while reports/ is not ignored, or with rejections.packet false',
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    const id = f.ids.changed;
    const P = projectOf(f);
    writeFileSync(f.latest(id), BROKEN);
    openRejection(P, 'visual', id, { via: 'dashboard', note: null });
    const diff = engineDiff(rustBin);
    await packetFor(P, 'visual', id, { diff, ignored: true });
    const dir = join(f.px, 'reports', 'rejected', id);
    assert.ok(existsSync(dir));
    // Told git would pick reports/ up: the packet goes, and the record says why.
    const no = await packetFor(P, 'visual', id, { diff, ignored: false });
    assert.deepEqual([no.record?.packet, no.record?.packetError], [null, NOT_IGNORED]);
    assert.ok(!existsSync(dir));
    // rejections.packet false: none, and no error.
    const cfg = JSON.parse(readFileSync(join(f.repo, 'pxsig.config.json'), 'utf8'));
    writeFileSync(
      join(f.repo, 'pxsig.config.json'),
      JSON.stringify({ ...cfg, rejections: { packet: false } })
    );
    const off = await packetFor(projectOf(f), 'visual', id, { diff, ignored: true });
    assert.deepEqual([off.record?.packet, off.record?.packetError], [null, undefined]);
    assert.ok(!existsSync(dir));
    // A render that is missing: the rejection stands, the record says why.
    writeFileSync(join(f.repo, 'pxsig.config.json'), JSON.stringify(cfg));
    openRejection(P, 'visual', f.ids.noRender, { via: 'dashboard', note: null });
    const miss = await packetFor(P, 'visual', f.ids.noRender, { diff, ignored: true });
    assert.equal(miss.record?.packetError, 'not written: the entry has no render yet');
  }
);

test(
  'the sweep removes packets whose rejection closed, and half-written ones',
  { skip: rust },
  (t) => {
    const f = fixture({ t });
    const P = projectOf(f);
    const root = join(f.px, 'reports', 'rejected');
    openRejection(P, 'visual', f.ids.changed, { via: 'dashboard', note: null });
    for (const n of [
      f.ids.changed,
      f.ids.ok,
      `${f.ids.changed}.a11y`,
      `${f.ids.ok}.tmp-1`,
      'not an id',
    ])
      mkdirSync(join(root, n), { recursive: true });
    assert.equal(sweepPackets(P), 4);
    assert.deepEqual(readdirSync(root), [f.ids.changed]);
  }
);
