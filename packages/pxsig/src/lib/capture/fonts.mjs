/**
 * fonts.mjs — the fonts a render's text was drawn in, `<id>.fonts.json` beside `<id>.png`
 * (docs/spec.md, section 7). Chromium only: after the screenshot, one
 * `CSS.getPlatformFontsForNode` per element under the capture root that has text of its own, the
 * faces summed per render:
 *
 *   { "v": 1, "used": [{ "family": "Inter", "glyphs": 120, "web": true },
 *                      { "digest": "1f2e3d4c", "glyphs": 4, "web": false }], "elements": 9 }
 *
 * A face is named only when the page's own CSS names it (a family in the computed `font-family`
 * of an element recorded) or it came from `@font-face` (`web`); any other face is the operating
 * system's fallback and is kept as the first 8 hex of a sha-256 of its names, as `fonts.probe`
 * keeps its families: a machine's font list never leaves it by name. Firefox and WebKit have no
 * such call: no record ("not recorded").
 */
import { rmSync, writeFileSync } from 'node:fs';
import { sha } from '../env/id.mjs';
/** @import { Page } from 'playwright' */
/** @import { UsedFace, UsedFonts } from '../../types/fonts.js' */

/** @param {string} png */
export const fontsFile = (png) => png.replace(/\.png$/i, '.fonts.json');

/** The attribute that marks the elements asked about, for as long as the call takes. */
const MARK = 'data-pxsig-fonts';

/**
 * In the page: mark the elements under `root` (or the body) with text of their own, and return
 * how many, with every family their computed `font-family` lists (lower case, unquoted).
 * @param {{ root: string | null, mark: string }} input
 */
export const MARK_TEXT = ({ root, mark }) => {
  const top = (root && document.querySelector(root)) || document.body;
  /** @type {Set<string>} */
  const families = new Set();
  let n = 0;
  for (const el of [top, ...top.querySelectorAll('*')]) {
    const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent?.trim());
    if (!own) continue;
    el.setAttribute(mark, '');
    n++;
    for (const f of getComputedStyle(el).fontFamily.split(','))
      families.add(
        f
          .trim()
          .replace(/^(["'])(.*)\1$/, '$2')
          .toLowerCase()
      );
  }
  return { n, families: [...families] };
};

/**
 * The record of the faces Chromium drew: one per family (or digest), glyphs summed, sorted.
 * @param {{ familyName: string, postScriptName?: string, isCustomFont?: boolean, glyphCount: number }[]} faces
 * @param {string[]} families the page's own families, lower case
 * @param {number} elements
 * @returns {UsedFonts}
 */
export function usedFonts(faces, families, elements) {
  const own = new Set(families);
  /** @type {Map<string, UsedFace>} */
  const by = new Map();
  for (const f of faces) {
    const web = f.isCustomFont === true;
    const named = web || own.has(f.familyName.toLowerCase());
    /** @type {UsedFace} */
    const face = named
      ? { family: f.familyName, glyphs: 0, web }
      : {
          digest: sha(`${f.familyName}\n${f.postScriptName ?? ''}`).slice(0, 8),
          glyphs: 0,
          web,
        };
    const key = faceKey(face);
    const seen = by.get(key) ?? face;
    seen.glyphs += f.glyphCount;
    by.set(key, seen);
  }
  // Named faces by family, then the digests: the order a person reads them in.
  const order = (/** @type {UsedFace} */ f) => (f.family != null ? `0${f.family}` : `1${f.digest}`);
  const used = [...by.values()].sort((a, b) =>
    order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0
  );
  return { v: 1, used, elements };
}

/**
 * A face's identity in a comparison: its family, or `#` and its digest; `web` faces apart.
 * @param {UsedFace} f
 */
export const faceKey = (f) => `${f.web ? 'web:' : ''}${f.family ?? `#${f.digest}`}`;

/**
 * Write `<id>.fonts.json` for the render at `png` (any older one removed first). Chromium only;
 * any failure leaves no record, which reads as "not recorded". Returns the record, or null.
 * @param {Page} page
 * @param {string} png
 * @param {{ root: string | null, browser: string }} opts
 * @returns {Promise<UsedFonts | null>}
 */
export async function writeFonts(page, png, { root, browser }) {
  const file = fontsFile(png);
  rmSync(file, { force: true });
  if (browser !== 'chromium') return null;
  try {
    const { n, families } = await page.evaluate(MARK_TEXT, { root, mark: MARK });
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('DOM.enable');
      const { root: doc } = await cdp.send('DOM.getDocument', { depth: 0 });
      const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
        nodeId: doc.nodeId,
        selector: `[${MARK}]`,
      });
      await cdp.send('CSS.enable');
      const answers = await Promise.all(
        nodeIds.map((nodeId) => cdp.send('CSS.getPlatformFontsForNode', { nodeId }))
      );
      const rec = usedFonts(
        answers.flatMap((a) => a.fonts),
        families,
        n
      );
      writeFileSync(file, `${JSON.stringify(rec)}\n`);
      return rec;
    } finally {
      await cdp.detach().catch(() => {});
    }
  } catch {
    return null;
  } finally {
    await page
      .evaluate(
        (m) => document.querySelectorAll(`[${m}]`).forEach((e) => e.removeAttribute(m)),
        MARK
      )
      .catch(() => {});
  }
}
