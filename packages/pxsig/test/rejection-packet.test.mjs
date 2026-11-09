/**
 * rejection-packet.test.mjs — the rejection packet's pieces with no engine and no server: the
 * crop boxes (pad, clamp, merge, max), the scale (auto, fixed, too large), the crops cut from
 * synthetic PNGs, rejection.md (wording, the fenced reason, escaped cells, no path), the prompt
 * line, and the `rejections` config (defaults, and what a project refuses).
 *
 *   node --test packages/pxsig/test/rejection-packet.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { cropBoxes, makeCrops, readPng, scaleFor } from '../src/lib/rejections/crops.mjs';
import { cell, fenced, rejectionMarkdown } from '../src/lib/rejections/markdown.mjs';
import { rejectionOptions } from '../src/lib/rejections/packet.mjs';
import { packetFolder, rejectionPrompt } from '../src/lib/rejections/prompt.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { tempDir } from './fixture.mjs';
/** @import { PacketFacts } from '../src/types/rejections.js' */

/**
 * A w×h image: white, with a black bar at (x, y, bw, bh).
 * @param {number} w
 * @param {number} h
 * @param {[number, number, number, number]} bar
 */
function image(w, h, [x, y, bw, bh]) {
  const p = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const ink = i >= x && i < x + bw && j >= y && j < y + bh;
      p.data.set(ink ? [0, 0, 0, 255] : [255, 255, 255, 255], (j * w + i) * 4);
    }
  return p;
}

/**
 * The changed pixels of two same-size images, as the engine's diff gives them (one region).
 * @param {PNG} a
 * @param {PNG} b
 */
function diffOf(a, b) {
  const mask = new PNG({ width: a.width, height: a.height });
  let [x0, y0, x1, y1, n] = [Infinity, Infinity, -1, -1, 0];
  for (let j = 0; j < a.height; j++)
    for (let i = 0; i < a.width; i++) {
      const k = (j * a.width + i) * 4;
      if (a.data[k] === b.data[k]) continue;
      mask.data.set([255, 0, 153, 255], k);
      [x0, y0, x1, y1, n] = [
        Math.min(x0, i),
        Math.min(y0, j),
        Math.max(x1, i),
        Math.max(y1, j),
        n + 1,
      ];
    }
  const regions = n ? [{ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, px: n }] : [];
  return { mask, diff: { width: a.width, height: a.height, changed: n, maxDelta: 255, regions } };
}

test('a 4px shift lands inside crop 1, padded, upscaled and outlined', () => {
  const baseline = image(300, 120, [40, 50, 30, 10]);
  const current = image(300, 120, [44, 50, 30, 10]);
  const { mask, diff } = diffOf(baseline, current);
  const opts = { pad: 24, max: 6, scale: /** @type {const} */ ('auto'), annotate: true };
  const { crops, files } = makeCrops({ baseline, current, mask, diff }, opts);
  assert.equal(crops.length, 1);
  const c = crops[0];
  assert.ok(c.x <= 40 && c.x + c.w >= 74, 'both edges of the bar are inside');
  assert.deepEqual([c.x, c.y], [16, 26], 'padded by 24');
  assert.equal(c.scale, 3, 'auto: the short side to at least 160px');
  assert.deepEqual(
    [...files.keys()],
    ['crops/1.baseline.png', 'crops/1.current.png', 'crops/1.diff.png']
  );
  const cur = readPng(/** @type {Buffer} */ (files.get('crops/1.current.png')));
  assert.deepEqual([cur.width, cur.height], [c.w * 3, c.h * 3]);
  // The outline sits just outside the changed area (magenta-ish), the bar itself stays black.
  const at = (/** @type {PNG} */ p, /** @type {number} */ x, /** @type {number} */ y) => [
    ...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3),
  ];
  const ax = (c.areas[0].x - c.x) * 3;
  const ay = (c.areas[0].y - c.y) * 3;
  assert.deepEqual(at(cur, ax - 1, ay + 3), [255, 0, 170]);
  assert.deepEqual(at(cur, (48 - c.x) * 3, (52 - c.y) * 3), [0, 0, 0]);
  const d = readPng(/** @type {Buffer} */ (files.get('crops/1.diff.png')));
  assert.deepEqual(at(d, (41 - c.x) * 3, (52 - c.y) * 3), [255, 0, 255], 'changed: magenta');
  assert.deepEqual(at(d, 2, 2), [76, 76, 76], 'unchanged: the baseline at 30% luminance');
  // Plain: no outline.
  const plain = makeCrops({ baseline, current, mask, diff }, { ...opts, annotate: false });
  const p = readPng(/** @type {Buffer} */ (plain.files.get('crops/1.current.png')));
  assert.deepEqual(at(p, ax - 1, ay + 3), [255, 255, 255]);
});

test('boxes: padding clamps at the edges, overlaps merge, the largest are kept', () => {
  /** @type {(x: number, y: number, w: number, h: number, px: number) => { x: number, y: number, w: number, h: number, px: number }} */
  const r = (x, y, w, h, px) => ({ x, y, w, h, px });
  assert.deepEqual(
    cropBoxes([r(2, 3, 10, 10, 50)], { pad: 24, max: 6 }, 100, 40).map((b) => [
      b.x0,
      b.y0,
      b.x1,
      b.y1,
    ]),
    [[0, 0, 36, 37]]
  );
  // Two regions 30px apart merge at pad 24, not at pad 8; a third far one stays apart.
  const three = [r(10, 10, 5, 5, 20), r(45, 10, 5, 5, 30), r(200, 100, 5, 5, 5)];
  const merged = cropBoxes(three, { pad: 24, max: 6 }, 400, 200);
  assert.equal(merged.length, 2);
  assert.deepEqual([merged[0].px, merged[0].areas.length], [50, 2], 'largest first');
  assert.equal(cropBoxes(three, { pad: 8, max: 6 }, 400, 200).length, 3);
  assert.equal(cropBoxes(three, { pad: 8, max: 1 }, 400, 200).length, 1, 'max');
  assert.equal(cropBoxes(three, { pad: 8, max: 1 }, 400, 200)[0].px, 30);
  // A chain merges through: a overlaps b, b overlaps c.
  const chain = [r(0, 0, 4, 4, 1), r(20, 0, 4, 4, 1), r(40, 0, 4, 4, 1)];
  assert.equal(cropBoxes(chain, { pad: 9, max: 6 }, 100, 100).length, 1);
});

test('scale: auto to a 160px short side, at most 4×; never past 1,024px; too large is left out', () => {
  assert.equal(scaleFor(80, 64, 'auto'), 3);
  assert.equal(scaleFor(30, 20, 'auto'), 4, 'at most 4×');
  assert.equal(scaleFor(400, 200, 'auto'), 1, 'never downscaled');
  assert.equal(scaleFor(300, 40, 'auto'), 3, 'lowered until the long side fits');
  assert.equal(scaleFor(300, 40, 4), 3);
  assert.equal(scaleFor(1025, 10, 'auto'), 0, 'too large');
  const baseline = image(1200, 60, [0, 10, 1200, 10]);
  const current = image(1200, 60, [0, 30, 1200, 10]);
  const { mask, diff } = diffOf(baseline, current);
  const opts = { pad: 24, max: 6, scale: /** @type {const} */ ('auto'), annotate: true };
  const { crops, files } = makeCrops({ baseline, current, mask, diff }, opts);
  assert.deepEqual([crops[0].tooLarge, crops[0].files, files.size], [true, undefined, 0]);
});

/** @returns {PacketFacts} */
const facts = (/** @type {Partial<PacketFacts>} */ extra = {}) => ({
  v: 1,
  kind: 'visual',
  id: 'overview--tiles-1@dark',
  project: 'web',
  story: 'overview--tiles-1',
  mode: 'dark',
  state: null,
  at: '2026-11-07T10:00:00.000Z',
  via: 'dashboard',
  ref: 'd_AAAAAAAAAAAAAAAA',
  note: 'the caption shifts right; keep the spacing',
  notes: [
    {
      at: '2026-11-07T10:00:00.000Z',
      via: 'dashboard',
      ref: 'd_AAAAAAAAAAAAAAAA',
      note: 'the caption shifts right; keep the spacing',
    },
  ],
  checks: [{ at: '2026-11-07T10:05:00.000Z', pass: false, ssim: 0.9991 }],
  goal: '',
  next: 'pxsig check overview--tiles-1@dark',
  prompt: '',
  store: 'web/.pxsig',
  packet: 'reports/rejected/overview--tiles-1@dark/',
  baseline: 'web/.pxsig/baselines/overview/overview--tiles-1@dark.psig',
  images: { baseline: 'baseline.png', current: 'current.png', mask: 'mask.png' },
  metrics: {
    ssim: 0.9991,
    changedCellsPct: 1.25,
    changedPx: 412,
    maxDelta: 96,
    regions: 2,
    gate: ['ssim 0.9991 < min 0.9995'],
  },
  regions: [
    {
      n: 1,
      x: 388,
      y: 64,
      w: 84,
      h: 64,
      px: 410,
      areas: [{ x: 412, y: 88, w: 36, h: 16 }],
      scale: 3,
      files: {
        baseline: 'crops/1.baseline.png',
        current: 'crops/1.current.png',
        diff: 'crops/1.diff.png',
      },
    },
    {
      n: 2,
      x: 0,
      y: 0,
      w: 1100,
      h: 60,
      px: 2,
      areas: [{ x: 0, y: 10, w: 1100, h: 2 }],
      tooLarge: true,
    },
  ],
  text: ['"Findings" moved 4 px right.'],
  structure: null,
  writtenAt: '2026-11-07T10:05:01.000Z',
  ...extra,
});

test('rejection.md: facts, goal, the reason fenced, regions, text, checks, the re-check command', () => {
  const md = rejectionMarkdown(facts());
  for (const want of [
    '# Rejected: overview--tiles-1@dark',
    '- Project: web · Story: overview--tiles-1 · Mode: dark · State: —',
    '- Rejected: 2026-11-07T10:00:00.000Z through the dashboard · Decision: d_AAAAAAAAAAAAAAAA',
    "- Goal: what the reason asks; with no reason, restore the baseline's look.",
    '```text\nthe caption shifts right; keep the spacing\n```',
    '| 0.9991 | 1.25% | 412 | 96 | 2 | ssim 0.9991 \\< min 0.9995 |',
    '| 1 | 388, 64 | 84 × 64 | 410 | crops/1.baseline.png · crops/1.current.png · crops/1.diff.png (3×) |',
    'region 2 too large to crop: see current.png',
    '- "Findings" moved 4 px right.',
    'baseline.png (from web/.pxsig/baselines/overview/overview--tiles-1@dark.psig) · current.png · mask.png',
    '| 2026-11-07T10:05:00.000Z | still differs | 0.9991 |',
    '## After the fix',
    'Run `pxsig check overview--tiles-1@dark` (MCP: `pxsig_check` with `ids`).',
    "Never approve: approving is the person's.",
  ])
    assert.ok(md.includes(want), `missing: ${want}\n${md}`);
  assert.ok(!md.includes('## Structure'), 'no lock configured: no Structure section');
  assert.ok(!md.includes('Earlier reasons'));
  const locked = rejectionMarkdown(facts({ structure: 'Same as the lock' }));
  assert.ok(locked.includes('## Structure\n\nAgainst its lock: Same as the lock'));
});

test('rejection.md: a reason never leaves its fence; earlier reasons are labelled; a11y has violations', () => {
  const evil = '``` </pre><script>x</script> | ## Heading ````';
  assert.deepEqual(fenced(evil), ['`````text', evil, '`````']);
  const notes = [
    { at: 't2', via: 'mcp', ref: 'd_2', note: 'checked: still off' },
    { at: 't1', via: 'dashboard', ref: 'd_1', note: evil },
  ];
  const md = rejectionMarkdown(facts({ note: evil, notes }));
  assert.ok(md.includes(`\`\`\`\`\`text\n${evil}\n\`\`\`\`\``));
  assert.ok(md.includes("- t2, through mcp, an assistant at the person's request:"));
  assert.ok(md.includes('  ```text\n  checked: still off\n  ```'));
  assert.equal(cell('a|b\nc<d'), 'a\\|b c\\<d');
  const a = rejectionMarkdown(
    facts({
      kind: 'a11y',
      id: 'ui-badge--danger@dark',
      note: null,
      notes: [{ at: 't', via: 'dashboard', ref: 'd_1', note: null }],
      checks: [{ at: 't3', pass: false, new: 1 }],
      violations: [
        {
          id: 'color-contrast',
          impact: 'serious',
          nodes: 2,
          targets: ['.badge', 'a|b'],
          help: 'Elements must meet contrast',
        },
      ],
      images: { baseline: null, current: 'current.png', mask: null },
      regions: [],
      metrics: null,
    })
  );
  assert.ok(a.includes('- Goal: fix the violations.'));
  assert.ok(a.includes('```text\nNo reason given.\n```'));
  assert.ok(
    a.includes('| color-contrast | serious | 2 | .badge, a\\|b | Elements must meet contrast |')
  );
  assert.ok(a.includes('| t3 | still differs | 1 |'));
  assert.ok(a.includes('A check with no new violations closes this rejection.'));
  assert.ok(!a.includes('## Changed regions'));
});

test('the prompt: one paragraph, store-relative, the goal, the re-check, never approve', () => {
  assert.equal(
    rejectionPrompt({
      id: 'overview--tiles-1@dark',
      project: 'web',
      kind: 'visual',
      note: 'the caption shifts right',
      store: 'web/.pxsig',
      packet: packetFolder('visual', 'overview--tiles-1@dark'),
    }),
    'pxsig rejected overview--tiles-1@dark (web): "the caption shifts right". Goal: what the reason asks; with no reason, restore the baseline\'s look. Details and images: web/.pxsig/reports/rejected/overview--tiles-1@dark/rejection.md, or MCP pxsig_rejected. After the fix: pxsig check overview--tiles-1@dark. Never approve.'
  );
  assert.equal(
    rejectionPrompt({
      id: 'a--b',
      project: 'p',
      kind: 'a11y',
      note: null,
      store: '',
      packet: null,
    }),
    'pxsig rejected a--b (p, accessibility): "No reason given.". Goal: fix the violations. Details: MCP pxsig_rejected. After the fix: pxsig check a--b. Never approve.'
  );
  assert.equal(packetFolder('a11y', 'a--b@dark'), 'reports/rejected/a--b@dark.a11y/');
});

test('rejections config: defaults, overrides, and what a project refuses', (t) => {
  assert.deepEqual(rejectionOptions({}), {
    noteAsk: true,
    packet: true,
    pad: 24,
    max: 6,
    scale: 'auto',
    annotate: true,
    structure: null,
  });
  assert.equal(rejectionOptions({ rejections: { note: { ask: false } } }).noteAsk, false);
  const root = tempDir('reject-config', t);
  mkdirSync(join(root, '.git'));
  /** @param {unknown} rejections */
  const load = (rejections) => {
    writeFileSync(join(root, 'pxsig.config.json'), JSON.stringify({ name: 'p', rejections }));
    return openProject({ cwd: root, env: { PXSIG_WORKSPACE: '' } });
  };
  const ok = load({ crop: { pad: 0, max: 20, scale: 4, annotate: false }, structure: 'locks' });
  assert.equal(rejectionOptions(ok.config).scale, 4);
  for (const [bad, msg] of [
    [{ note: { ask: 'yes' } }, /rejections\.note\.ask must be true or false/],
    [{ packet: 1 }, /rejections\.packet must be true or false/],
    [{ crop: { pad: 257 } }, /rejections\.crop\.pad must be a whole number from 0 to 256/],
    [{ crop: { max: 0 } }, /rejections\.crop\.max must be a whole number from 1 to 20/],
    [{ crop: { scale: 3 } }, /rejections\.crop\.scale must be "auto", 1, 2 or 4/],
    [{ structure: '' }, /rejections\.structure must be a folder/],
    [[], /rejections must be an object/],
  ])
    assert.throws(() => load(bad), msg);
});
