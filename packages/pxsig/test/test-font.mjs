/**
 * test-font.mjs — a small TrueType font built in code, for the tests that compare renders byte for
 * byte. With it a story's text never goes through the operating system's font matching (which
 * gave one macOS runner's render another font for `sans-serif`, 1 px wider), and no font file is
 * committed: the bytes are made here, the same on every machine.
 *
 * Every printable ASCII character and `·` (U+00B7) has a glyph of square cells on a 5 × 7 grid,
 * its pattern and width (3–5 cells) drawn from its code point, so every character looks and
 * measures differently; the space is empty. `fontFace()` is the @font-face rule (a data: URL),
 * `FAMILY` its name, and `fontGate` a script for a story page that holds the render until the face
 * has loaded and shows Storybook's error display when it has not.
 */

export const FAMILY = 'pxsig-test';
const EM = 1000;
const CELL = 100;
const ASCENT = 800;
const DESCENT = 200;
/** The characters with a glyph, in glyph order after .notdef. */
const CHARS = [...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => 0x20 + i), 0xb7];

/** A deterministic 32-bit mix of `n` (the glyph's pattern). */
function mix(/** @type {number} */ n) {
  let x = (n + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * The glyph of code point `cp`: its advance and its cells' rectangles (font units, y up).
 * @param {number} cp
 */
function glyphOf(cp, seed = 0) {
  if (cp === 0x20) return { advance: 3 * CELL, rects: [] };
  const h = mix(cp + seed * 0x10000);
  const cols = 3 + (h % 3);
  /** @type {[number, number, number, number][]} */
  const rects = [];
  for (let row = 0; row < 7; row++)
    for (let col = 0; col < cols; col++) {
      const bit = (mix(cp * 64 + row * 8 + col + seed * 0x100000) >>> 7) & 1;
      // The middle dot keeps one centred cell, so it reads as a dot.
      const on = cp === 0xb7 ? row === 3 && col === 1 : bit === 1 || (row === 0 && col === 0);
      if (on) rects.push([50 + col * CELL, row * CELL, 50 + (col + 1) * CELL, (row + 1) * CELL]);
    }
  return { advance: 100 + cols * CELL, rects };
}

/** A big-endian byte writer. */
class Out {
  constructor() {
    /** @type {number[]} */
    this.b = [];
  }
  u8(/** @type {number} */ v) {
    this.b.push(v & 0xff);
    return this;
  }
  u16(/** @type {number} */ v) {
    return this.u8(v >> 8).u8(v);
  }
  i16(/** @type {number} */ v) {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(/** @type {number} */ v) {
    return this.u16(Math.floor(v / 0x10000) & 0xffff).u16(v & 0xffff);
  }
  bytes(/** @type {ArrayLike<number>} */ a) {
    for (let i = 0; i < a.length; i++) this.b.push(a[i]);
    return this;
  }
  pad4() {
    while (this.b.length % 4) this.b.push(0);
    return this;
  }
}

/** The sum of a table's big-endian 32-bit words (zero-padded), mod 2^32. */
function checksum(/** @type {number[]} */ b) {
  let s = 0;
  for (let i = 0; i < b.length; i += 4)
    s =
      (s + ((b[i] << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>>
      0;
  return s;
}

/**
 * The font's bytes: a TrueType (glyf) font with the tables Chromium's sanitizer asks for. `name`:
 * the family its name table says (what Chromium reports drawing in); `seed`: another set of glyphs
 * (a second, different face).
 * @param {{ name?: string, seed?: number }} [opts]
 */
export function fontBytes({ name: family = FAMILY, seed = 0 } = {}) {
  const notdef = {
    advance: 500,
    rects: /** @type {[number, number, number, number][]} */ ([[50, 0, 450, 700]]),
  };
  const glyphs = [notdef, ...CHARS.map((cp) => glyphOf(cp, seed))];
  // glyf and loca (long offsets).
  const glyf = new Out();
  /** @type {number[]} */
  const loca = [];
  const box = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  let maxPoints = 0;
  let maxContours = 0;
  for (const g of glyphs) {
    loca.push(glyf.b.length);
    if (!g.rects.length) continue;
    const xs = g.rects.flatMap((r) => [r[0], r[2]]);
    const ys = g.rects.flatMap((r) => [r[1], r[3]]);
    const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    box.xMin = Math.min(box.xMin, x0);
    box.xMax = Math.max(box.xMax, x1);
    box.yMax = Math.max(box.yMax, y1);
    maxPoints = Math.max(maxPoints, g.rects.length * 4);
    maxContours = Math.max(maxContours, g.rects.length);
    glyf.i16(g.rects.length).i16(x0).i16(y0).i16(x1).i16(y1);
    g.rects.forEach((_, i) => glyf.u16(i * 4 + 3));
    glyf.u16(0); // no instructions
    // Each cell clockwise (TrueType fills clockwise contours): its four corners, on the curve.
    const pts = g.rects.flatMap(([a, b, c, d]) => [
      [a, b],
      [a, d],
      [c, d],
      [c, b],
    ]);
    for (let i = 0; i < pts.length; i++) glyf.u8(0x01);
    let px = 0;
    for (const [x] of pts) {
      glyf.i16(x - px);
      px = x;
    }
    let py = 0;
    for (const [, y] of pts) {
      glyf.i16(y - py);
      py = y;
    }
    glyf.pad4();
  }
  loca.push(glyf.b.length);
  const n = glyphs.length;
  const advMax = Math.max(...glyphs.map((g) => g.advance));
  const lsb = (/** @type {typeof notdef} */ g) =>
    g.rects.length ? Math.min(...g.rects.map((r) => r[0])) : 0;

  const head = new Out()
    .u32(0x00010000)
    .u32(0x00010000)
    .u32(0) // checkSumAdjustment, set below
    .u32(0x5f0f3cf5)
    .u16(0x000b)
    .u16(EM)
    .u32(0)
    .u32(0) // created: fixed, so the bytes never change
    .u32(0)
    .u32(0) // modified
    .i16(box.xMin)
    .i16(box.yMin)
    .i16(box.xMax)
    .i16(box.yMax)
    .u16(0)
    .u16(8)
    .i16(2)
    .i16(1) // long loca
    .i16(0);
  const hhea = new Out()
    .u32(0x00010000)
    .i16(ASCENT)
    .i16(-DESCENT)
    .i16(0)
    .u16(advMax)
    .i16(0)
    .i16(0)
    .i16(box.xMax)
    .i16(1)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .u16(n);
  const hmtx = new Out();
  for (const g of glyphs) hmtx.u16(g.advance).i16(lsb(g));
  const maxp = new Out().u32(0x00010000).u16(n).u16(maxPoints).u16(maxContours).u16(0).u16(0);
  maxp.u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);
  const avg = Math.round(glyphs.reduce((s, g) => s + g.advance, 0) / n);
  const os2 = new Out().u16(4).i16(avg).u16(400).u16(5).u16(0);
  for (const v of [650, 600, 0, 75, 650, 600, 0, 350, 50, 300, 0]) os2.i16(v);
  os2
    .bytes(Array.from({ length: 10 }, () => 0))
    .u32(1)
    .u32(0)
    .u32(0)
    .u32(0); // Basic Latin
  os2.bytes([0x50, 0x58, 0x53, 0x47]).u16(0x40).u16(0x20).u16(0xb7);
  os2.i16(ASCENT).i16(-DESCENT).i16(0).u16(ASCENT).u16(DESCENT).u32(1).u32(0);
  os2.i16(500).i16(700).u16(0).u16(0x20).u16(1);
  const post = new Out()
    .u32(0x00030000)
    .u32(0)
    .i16(-100)
    .i16(50)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0);
  // name: family, style, unique id, full name, PostScript name (Windows, Unicode, en-US).
  const names = [
    [1, family],
    [2, 'Regular'],
    [3, `${family}-1`],
    [4, family],
    [6, family],
  ];
  const strings = new Out();
  const name = new Out()
    .u16(0)
    .u16(names.length)
    .u16(6 + names.length * 12);
  for (const [id, s] of names) {
    const str = /** @type {string} */ (s);
    name
      .u16(3)
      .u16(1)
      .u16(0x409)
      .u16(/** @type {number} */ (id))
      .u16(str.length * 2);
    name.u16(strings.b.length);
    for (const ch of str) strings.u16(ch.charCodeAt(0));
  }
  name.bytes(strings.b);
  // cmap: format 4, one segment per run of consecutive code points, then the 0xFFFF end.
  /** @type {[number, number, number][]} */
  const segs = [];
  CHARS.forEach((cp, i) => {
    const last = segs[segs.length - 1];
    if (last && last[1] === cp - 1 && last[2] + (cp - last[0]) === i + 1) last[1] = cp;
    else segs.push([cp, cp, i + 1]);
  });
  segs.push([0xffff, 0xffff, 0]);
  const segX2 = segs.length * 2;
  const range = 2 * 2 ** Math.floor(Math.log2(segs.length));
  const sub = new Out()
    .u16(4)
    .u16(16 + segs.length * 8)
    .u16(0)
    .u16(segX2)
    .u16(range)
    .u16(Math.log2(range / 2))
    .u16(segX2 - range);
  for (const s of segs) sub.u16(s[1]);
  sub.u16(0);
  for (const s of segs) sub.u16(s[0]);
  for (const s of segs) sub.u16(s[0] === 0xffff ? 1 : (s[2] - s[0] + 0x10000) & 0xffff);
  for (const _ of segs) sub.u16(0);
  const cmap = new Out().u16(0).u16(1).u16(3).u16(1).u32(12).bytes(sub.b);
  const locaOut = new Out();
  for (const o of loca) locaOut.u32(o);

  /** @type {[string, number[]][]} */
  const tables = [
    ['OS/2', os2.b],
    ['cmap', cmap.b],
    ['glyf', glyf.b],
    ['head', head.b],
    ['hhea', hhea.b],
    ['hmtx', hmtx.b],
    ['loca', locaOut.b],
    ['maxp', maxp.b],
    ['name', name.b],
    ['post', post.b],
  ];
  const sr = 16 * 2 ** Math.floor(Math.log2(tables.length));
  const font = new Out()
    .u32(0x00010000)
    .u16(tables.length)
    .u16(sr)
    .u16(Math.log2(sr / 16))
    .u16(tables.length * 16 - sr);
  let offset = 12 + tables.length * 16;
  for (const [tag, b] of tables) {
    font
      .bytes(Array.from({ length: 4 }, (_, i) => tag.charCodeAt(i)))
      .u32(checksum(b))
      .u32(offset)
      .u32(b.length);
    offset += Math.ceil(b.length / 4) * 4;
  }
  let headAt = 0;
  for (const [tag, b] of tables) {
    if (tag === 'head') headAt = font.b.length;
    font.bytes(b).pad4();
  }
  const adjust = (0xb1b0afba - checksum(font.b) + 0x100000000) % 0x100000000;
  const fix = new Out().u32(adjust).b;
  font.b.splice(headAt + 8, 4, ...fix);
  return Buffer.from(font.b);
}

/** The @font-face rule for the font, from a data: URL. */
/**
 * The @font-face rule for the font, from a data: URL: CSS family `css` (default FAMILY), the face's
 * own name and glyphs as `fontBytes` takes them.
 * @param {{ css?: string, name?: string, seed?: number }} [opts]
 */
export const fontFace = ({ css = FAMILY, ...face } = {}) =>
  `@font-face{font-family:${css};src:url(data:font/ttf;base64,${fontBytes(face).toString('base64')}) format('truetype');font-display:block}`;

/**
 * A story page's script: the preview says its story finished only once the face has loaded (no
 * other font can stand in), and shows Storybook's error display, with why, when it has not.
 * `id`: the story.
 * @param {string} id
 */
export const fontGate = (id) => `<script>
window.__STORYBOOK_PREVIEW__ = { storeInitializationPromise: Promise.resolve(), currentRender: { id: ${JSON.stringify(id)}, phase: 'loading' } };
document.fonts.load('16px ${FAMILY}').then((faces) => {
  if (faces.length && document.fonts.check('16px ${FAMILY}')) {
    window.__STORYBOOK_PREVIEW__.currentRender.phase = 'finished';
    return;
  }
  throw new Error('no face');
}).catch((e) => {
  document.body.className = 'sb-show-errordisplay';
  document.getElementById('error-message').textContent = 'the test font did not load: ' + e.message;
  window.__STORYBOOK_PREVIEW__.currentRender.phase = 'errored';
});
</script>`;
