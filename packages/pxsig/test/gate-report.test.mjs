/**
 * gate-report.test.mjs — the gate report (lib/gate-report.mjs) with no engine and no server: the
 * story id replaced by default and kept on request, no path or user name anywhere in what it hands
 * out, the composite cropped to the changed regions with its margin (or the full capture), the
 * image-free report with no image and each region's average colors, the issue link within its
 * length, the refusals, and the files `writeGateReport` keeps.
 *
 *   node --test packages/pxsig/test/gate-report.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import {
  ENTRY_STAND_IN,
  envClass,
  gateReport,
  GateReportError,
  scrub,
  writeGateReport,
} from '../src/lib/gate-report.mjs';
import { cropBox, MARGIN } from '../src/lib/gate-report/image.mjs';
import { ISSUE_BASE, issueUrl, MAX_URL, TRIMMED } from '../src/lib/gate-report/text.mjs';
import { ID, image, jsDiff, reportProject, STORY } from './gate-report-helpers.mjs';

const USER = 'someone.private';

/**
 * Everything a report hands out, as one string: the text, the link, the facts.
 * @param {Awaited<ReturnType<typeof gateReport>>} r
 */
const out = (r) => [r.text, decodeURIComponent(r.url), JSON.stringify(r.facts)].join('\n');

/**
 * No path, user name or (unless kept) story id in `s`.
 * @param {string} s
 * @param {{ root: string, keepId?: boolean }} o
 */
function assertClean(s, { root, keepId = false }) {
  assert.ok(!s.includes(root), 'no workspace path');
  assert.ok(!s.includes(homedir()), 'no home folder');
  const me = (() => {
    try {
      return userInfo().username;
    } catch {
      return '';
    }
  })();
  if (me.length > 2) assert.ok(!new RegExp(`(?<!\\w)${me}(?!\\w)`, 'i').test(s), 'no user name');
  assert.ok(!s.includes(USER), 'no user name passed in');
  assert.ok(!/(^|[\s"'(])\/(Users|home|private|var|tmp)\//.test(s), 'no absolute POSIX path');
  assert.ok(!/[A-Za-z]:\\/.test(s), 'no Windows path');
  if (!keepId) {
    assert.ok(!s.includes(ID) && !s.includes(STORY), 'no story id');
    assert.ok(!s.includes('secret'), 'nothing of the id at all');
  }
}

test('by default: entry-1 for the story id, no path or user name anywhere', async (t) => {
  const { P, root } = reportProject(t, {
    row: { reasons: ['ssim 0.9 < min 0.99', `a note from ${USER}`] },
  });
  const r = await gateReport(P, ID, { diff: jsDiff, user: USER });
  assert.equal(r.facts.entry, ENTRY_STAND_IN);
  assert.equal(r.facts.state, null);
  assertClean(out(r), { root });
  assert.match(r.text, /### Gate settings\n\n```json\n\{\n {2}"threshold": 24/);
  assert.match(r.text, /"color": \{\n {4}"deltaE": 3/, 'the color rule is in the gate');
  assert.match(r.text, /- ssim 0\.9 < min 0\.99\n- a note from <user>/);
  assert.match(r.text, /verdict: fails the gate/);
  assert.match(r.text, /color: flatArea 532 · flatDeltaE 7\.8 · cells 4 · maxCellDeltaE 9\.1/);
  assert.match(r.text, /render: macOS arm64 · chromium 141 · GPU angle-metal/);
  assert.match(r.text, /1\. x 60, y 40 · 40×20 · 800 px/);
  assert.match(r.text, /entry-1 · mode dark/);
});

test('the workspace path in a reason is replaced too', async (t) => {
  const { P, root } = reportProject(t);
  const r = await gateReport(P, ID, { diff: jsDiff, user: null });
  assert.match(r.text, /rendered at <workspace>\/src/);
  assertClean(out(r), { root });
});

test('keepId keeps the story id and its state', async (t) => {
  const { P, root } = reportProject(t, { row: { state: 'hover' } });
  const r = await gateReport(P, ID, { diff: jsDiff, keepId: true, user: USER });
  assert.equal(r.facts.entry, ID);
  assert.equal(r.facts.state, 'hover');
  assert.match(r.text, new RegExp(`${ID} · mode dark · state hover`));
  assertClean(out(r), { root, keepId: true });
});

test('the composite: baseline | render | diff, cropped to the change with its margin', async (t) => {
  const { P } = reportProject(t);
  const r = await gateReport(P, ID, { diff: jsDiff, user: null });
  const img = /** @type {NonNullable<typeof r.facts.image>} */ (r.facts.image);
  assert.equal(img.crop, 'regions');
  assert.deepEqual(img.box, {
    x: 60 - MARGIN,
    y: 40 - MARGIN,
    w: 40 + 2 * MARGIN,
    h: 20 + 2 * MARGIN,
  });
  assert.ok(img.scale >= 2, 'a small crop is upscaled');
  const png = PNG.sync.read(/** @type {Buffer} */ (r.image));
  assert.equal(png.width, img.box.w * img.scale * 3 + 16, 'three panels and two gaps');
  assert.equal(png.height, img.box.h * img.scale);
  const at = (/** @type {number} */ x, /** @type {number} */ y) => [
    ...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3),
  ];
  /** @returns {[number, number]} */
  const mid = (/** @type {number} */ panel) => [
    panel * (img.box.w * img.scale + 8) + Math.floor((img.box.w * img.scale) / 2),
    Math.floor((img.box.h * img.scale) / 2),
  ];
  assert.deepEqual(at(...mid(0)), [31, 122, 67], 'the baseline: green');
  assert.deepEqual(at(...mid(1)), [122, 31, 106], 'the render: purple');
  assert.deepEqual(at(...mid(2)), [255, 0, 255], 'the diff: changed in magenta');
  assert.match(r.text, /cropped to the changed regions with a 16 px margin/);
});

test('crop bounds clamp to the capture; nothing changed is no box', () => {
  assert.deepEqual(cropBox([{ x: 2, y: 3, w: 5, h: 5, px: 9 }], 50, 40), {
    x: 0,
    y: 0,
    w: 2 + 5 + MARGIN,
    h: 3 + 5 + MARGIN,
  });
  assert.deepEqual(
    cropBox(
      [
        { x: 10, y: 10, w: 2, h: 2, px: 4 },
        { x: 80, y: 30, w: 4, h: 4, px: 16 },
      ],
      100,
      40
    ),
    { x: 0, y: 0, w: 100, h: 40 },
    'two regions: one box around both, clamped'
  );
  assert.equal(cropBox([], 100, 40), null);
});

test('full: the whole capture, unscaled; nothing changed falls back to the full capture', async (t) => {
  const { P } = reportProject(t);
  const r = await gateReport(P, ID, { diff: jsDiff, full: true, user: null });
  assert.deepEqual(r.facts.image?.box, { x: 0, y: 0, w: 200, h: 100 });
  assert.equal(r.facts.image?.scale, 1);
  assert.equal(PNG.sync.read(/** @type {Buffer} */ (r.image)).width, 200 * 3 + 16);
  assert.match(r.text, /the full capture/);
  const same = image(200, 100, [250, 250, 250], []);
  const q = reportProject(t, { base: same, render: same, row: { pass: true, reasons: [] } });
  const s = await gateReport(q.P, ID, { diff: jsDiff, user: null });
  assert.equal(s.facts.image?.crop, 'full');
  assert.match(s.text, /verdict: passes the gate/);
  assert.match(s.text, /None: it passed\./);
  assert.match(s.text, /None: the images are the same pixel for pixel\./);
});

test('image-free: no image at all, each region with its average colors', async (t) => {
  const { P, root } = reportProject(t);
  const r = await gateReport(P, ID, { diff: jsDiff, noImage: true, user: null });
  assert.equal(r.image, null);
  assert.equal(r.facts.image, null);
  assert.deepEqual(
    r.facts.regions.map((x) => [x.baseline, x.render]),
    [['#1f7a43', '#7a1f6a']]
  );
  assert.match(r.text, /baseline #1f7a43 → render #7a1f6a/);
  assert.match(r.text, /None: an image-free report/);
  assert.ok(!/data:image|base64|PNG/.test(out(r)));
  assertClean(out(r), { root });
});

test('the issue link: the gate form, its fields filled, within the length limit', async (t) => {
  const { P } = reportProject(t);
  const r = await gateReport(P, ID, { diff: jsDiff, user: null });
  const u = new URL(r.url);
  assert.equal(`${u.origin}${u.pathname}`, ISSUE_BASE);
  assert.equal(u.searchParams.get('template'), 'gate.yml');
  for (const k of ['version', 'entry', 'gate', 'metrics', 'reasons', 'regions', 'environment'])
    assert.ok(u.searchParams.get(k), k);
  assert.equal(u.searchParams.get('entry'), 'entry-1 · mode dark');
  assert.ok(r.url.length <= MAX_URL);
  assert.deepEqual(r.trimmed, []);

  // Hundreds of reasons and regions: cut, line by line, with the note, under the limit.
  const facts = {
    ...r.facts,
    reasons: Array.from({ length: 400 }, (_, i) => `reason ${i} ${'x'.repeat(40)}`),
    regions: Array.from({ length: 20 }, (_, i) => ({ x: i, y: i, w: 1, h: 1, px: 1 })),
  };
  const long = issueUrl(facts);
  assert.ok(long.url.length <= MAX_URL, `${long.url.length} <= ${MAX_URL}`);
  assert.ok(long.trimmed.includes('reasons'));
  const reasons = /** @type {string} */ (new URL(long.url).searchParams.get('reasons'));
  assert.ok(reasons.endsWith(TRIMMED));
  assert.ok(reasons.startsWith('- reason 0 '), 'the first lines are kept');
  assert.ok(issueUrl(facts, { max: 3000 }).url.length <= 3000);
});

test('nothing to report: no check, a render error, no baseline', async (t) => {
  const a = reportProject(t, { row: { id: 'other--entry' } });
  await assert.rejects(gateReport(a.P, ID, { diff: jsDiff }), GateReportError);
  const b = reportProject(t, { row: { error: 'PNG not found' } });
  await assert.rejects(gateReport(b.P, ID, { diff: jsDiff }), /did not render/);
  const c = reportProject(t, { sig: false });
  await assert.rejects(gateReport(c.P, ID, { diff: jsDiff }), /no baseline image/);
  await assert.rejects(gateReport(c.P, '../x', { diff: jsDiff }), /not an entry id/);
});

test('writeGateReport: report.md, report.json, image.png in the store; image-free removes it', async (t) => {
  const { P, px, root } = reportProject(t);
  const r = await gateReport(P, ID, { diff: jsDiff, user: null });
  const w = writeGateReport(P, ID, r);
  assert.equal(w.folder, `reports/gate-report/${ID}/`);
  assert.deepEqual(
    w.files,
    ['report.md', 'report.json', 'image.png'].map((f) => `${w.folder}${f}`)
  );
  const dir = join(px, 'reports', 'gate-report', ID);
  const md = readFileSync(join(dir, 'report.md'), 'utf8');
  assert.ok(md.startsWith(r.text));
  assert.ok(md.includes(r.url));
  const json = readFileSync(join(dir, 'report.json'), 'utf8');
  assertClean(md + json, { root });
  const free = await gateReport(P, ID, { diff: jsDiff, noImage: true, user: null });
  writeGateReport(P, ID, free);
  assert.ok(!existsSync(join(dir, 'image.png')));
});

test('scrub and envClass: names, paths and machine words never pass', () => {
  assert.equal(
    scrub('a-b--c@dark at /w/x by Bob, a-b--c', {
      id: 'a-b--c@dark',
      story: 'a-b--c',
      roots: ['/w/x'],
      user: 'bob',
    }),
    'entry-1 at <workspace> by <user>, entry-1'
  );
  assert.equal(envClass(null), null);
  const e = /** @type {Parameters<typeof envClass>[0]} */ (
    /** @type {unknown} */ ({
      os: { platform: 'linux', arch: 'x64' },
      browser: { name: 'chromium', version: '140.1' },
      render: { gpu: 'my laptop/GPU (Bob)' },
      container: { image: 'registry/x' },
    })
  );
  assert.equal(envClass(e), 'Linux x64 · chromium 140 · GPU unknown · container');
});
