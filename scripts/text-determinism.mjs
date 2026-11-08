#!/usr/bin/env node
/**
 * text-determinism.mjs — is a text record (packages/pxsig/src/lib/capture/boxes.mjs) the same on
 * every OS? Renders a fixed corpus with text capture on, on this machine (or in pxsig's container),
 * and compares the records made in different places. The text-determinism workflow runs it in the
 * container and on the Linux, macOS and Windows runners; nothing here is a required check.
 *
 *   node scripts/text-determinism.mjs render --out <dir> [--build <dashboard build>] [--font <woff2>]
 *       the dashboard's fixture screens (each theme), when --build is given, and the pages below,
 *       each in the browser's default fonts and, with --font, in that web font: <out>/<name>.boxes.json
 *       plus <out>/timings.json (the collector's time per page, measured in Node)
 *   node scripts/text-determinism.mjs compare <dir> <dir>… [--md <file>]
 *       each later folder against the first: files byte for byte, the same strings in the same
 *       order, how far runs and painted boxes moved; Markdown on stdout (and appended to <file>)
 *
 * Exit: 0 ran (whatever differs) · 1 a render failed · 2 usage.
 */
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/** @import { TextRecord } from '../packages/pxsig/src/types/text.js' */

const repo = fileURLToPath(new URL('..', import.meta.url));
const MOVE_PX = 0.5;

/** Pages with text of every kind the record holds: wrapped copy, a table, tiles, mono, SVG. */
export const PAGES = {
  prose: `<article style="width:420px;padding:16px"><h1 style="margin:0 0 8px">Release notes</h1>
    <p style="margin:0 0 8px">Text capture records each run the screenshot draws, with a box per line, so a copy change reads as copy and the text it pushed reads as moved.</p>
    <p style="margin:0"><b>Bold</b>, <i>italic</i>, <code>code</code> and a <a href="#x">link</a> on one line.</p></article>`,
  tiles: `<div style="display:flex;gap:8px;padding:16px">${[
    '1 new',
    '5 of 9 analysed',
    '1 of 7 entries',
    '+1 new reason',
  ]
    .map(
      (t, i) =>
        `<div data-testid="tile-${i}" style="border:1px solid #888;border-radius:6px;padding:8px 12px;background:#f4f4f4"><span style="font-size:20px;font-weight:600">${t.split(' ')[0]} </span><span>${t.split(' ').slice(1).join(' ')}</span></div>`
    )
    .join('')}</div>`,
  table: `<table style="border-collapse:collapse;margin:16px;font-size:13px">${[
    ['Entry', 'State', 'SSIM'],
    ['button--primary', 'changed', '0.9871'],
    ['card--default@light', 'passed', '1.0000'],
    ['overview--react-1@dark', 'new', '—'],
  ]
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td style="border:1px solid #ccc;padding:4px 8px">${c}</td>`).join('')}</tr>`
    )
    .join('')}</table>`,
  mono: `<pre style="margin:16px;font:12px/16px monospace">pxsig check --full\n[check] rendered 508 entries in 60.4 s\n  2 changed · 1 new</pre>`,
  svg: `<svg width="320" height="80" style="margin:16px"><rect x="1" y="1" width="318" height="78" fill="none" stroke="#888"/><text x="12" y="30" font-size="14">Changed pixels</text><text x="12" y="60" font-size="11">0 outside text</text></svg>`,
};

/**
 * @param {string[]} args
 * @param {string} name
 */
const flag = (args, name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : (args[i + 1] ?? '');
};

/**
 * Render the corpus into `out`.
 * @param {{ out: string, build: string | null, font: string | null }} o
 */
export async function render({ out, build, font }) {
  const { launchBrowser } = await import('../packages/pxsig/src/lib/capture.mjs');
  const { collectBoxes, MAX_RECORDED } =
    await import('../packages/pxsig/src/lib/capture/boxes.mjs');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const browser = await launchBrowser({ root: repo, workspaceRoot: repo });
  /** @type {Record<string, number>} */
  const timings = {};
  try {
    const faces = font ? [null, 'web'] : [null];
    for (const face of faces)
      for (const [name, html] of Object.entries(PAGES)) {
        const page = await browser.newPage({
          viewport: { width: 900, height: 600 },
          deviceScaleFactor: 1,
        });
        if (face && font)
          await page.route('http://fonts.invalid/face.woff2', (r) =>
            r.fulfill({ body: readFileSync(font), contentType: 'font/woff2' })
          );
        const css = face
          ? `@font-face{font-family:Face;src:url(http://fonts.invalid/face.woff2)}body,pre,svg text{font-family:Face !important}`
          : '';
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;color:#111}${css}</style></head><body><div id="root" style="display:inline-block">${html}</div></body></html>`
        );
        await page.evaluate(() => document.fonts.ready);
        const t = performance.now();
        const rec = await page.evaluate(collectBoxes, {
          root: '#root',
          ignore: [],
          max: MAX_RECORDED,
        });
        const key = `page--${name}${face ? `.${face}` : ''}`;
        timings[key] = Math.round((performance.now() - t) * 100) / 100;
        writeFileSync(join(out, `${key}.boxes.json`), JSON.stringify(rec));
        await page.close();
      }
    if (build) {
      const { dashboardCheck } = await import('../packages/pxsig/src/dashboard-check.mjs');
      const tmp = join(out, '.screens');
      await dashboardCheck({ build, out: tmp, reference: build }, repo, {
        browser,
        log: () => {},
        text: { ignore: [] },
      });
      const shots = join(tmp, 'shots', 'adapter');
      for (const f of readdirSync(shots).filter((n) => n.endsWith('.boxes.json')))
        cpSync(join(shots, f), join(out, `screen--${f}`));
      rmSync(tmp, { recursive: true, force: true });
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(out, 'timings.json'), `${JSON.stringify(timings, null, 2)}\n`);
  return Object.keys(timings).length;
}

/**
 * How record `b` differs from record `a`.
 * @param {TextRecord} a
 * @param {TextRecord} b
 */
export function diffRecords(a, b) {
  const sa = a.runs.map((r) => r.s);
  const sb = b.runs.map((r) => r.s);
  const sameStrings = sa.length === sb.length && sa.every((s, i) => s === sb[i]);
  let moved = 0;
  let lines = 0;
  let maxDx = 0;
  let maxDy = 0;
  let maxDw = 0;
  if (sameStrings)
    a.runs.forEach((r, i) => {
      const q = b.runs[i];
      if (r.boxes.length !== q.boxes.length) lines++;
      const [x0, y0] = r.boxes[0] ?? [0, 0];
      const [x1, y1] = q.boxes[0] ?? [0, 0];
      const w = (/** @type {number[][]} */ bx) => bx.reduce((n, x) => n + x[2], 0);
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const dw = Math.abs(w(q.boxes) - w(r.boxes));
      if (dx > MOVE_PX || dy > MOVE_PX || dw > MOVE_PX) moved++;
      maxDx = Math.max(maxDx, dx);
      maxDy = Math.max(maxDy, dy);
      maxDw = Math.max(maxDw, dw);
    });
  const sameElements = a.elements.length === b.elements.length;
  let maxBox = 0;
  if (sameElements)
    a.elements.forEach((e, i) => {
      const f = b.elements[i].box;
      maxBox = Math.max(maxBox, ...e.box.map((v, k) => Math.abs(f[k] - v)));
    });
  const fam = new Set(a.styles.map((s) => s.family));
  return {
    sameStrings,
    runs: a.runs.length,
    moved,
    lines,
    maxDx: round(maxDx),
    maxDy: round(maxDy),
    maxDw: round(maxDw),
    sameElements,
    maxBox: round(maxBox),
    sameFamilies: b.styles.every((s) => fam.has(s.family)),
    notLoaded: b.styles.filter((s) => s.loaded === false).length,
  };
}

const round = (/** @type {number} */ v) => Math.round(v * 100) / 100;

/**
 * Compare each later folder against the first: a Markdown report.
 * @param {string[]} dirs
 */
export function compare(dirs) {
  const [ref, ...rest] = dirs;
  const files = readdirSync(ref)
    .filter((f) => f.endsWith('.boxes.json'))
    .sort();
  const out = [
    `### Text records: ${dirs.map((d) => `\`${d.split(/[\\/]/).pop()}\``).join(' vs ')}`,
    '',
  ];
  for (const other of rest) {
    const name = `${ref.split(/[\\/]/).pop()} → ${other.split(/[\\/]/).pop()}`;
    const rows = [];
    let identical = 0;
    let missing = 0;
    for (const f of files) {
      let rb;
      try {
        rb = readFileSync(join(other, f));
      } catch {
        missing++;
        continue;
      }
      const ra = readFileSync(join(ref, f));
      if (ra.equals(rb)) {
        identical++;
        continue;
      }
      rows.push({
        f,
        // Both are records text capture wrote (TextRecord).
        ...diffRecords(
          /** @type {TextRecord} */ (JSON.parse(ra.toString('utf8'))),
          /** @type {TextRecord} */ (JSON.parse(rb.toString('utf8')))
        ),
      });
    }
    const differ = rows.length;
    const strings = rows.filter((r) => !r.sameStrings);
    const runs = rows.reduce((n, r) => n + (r.sameStrings ? r.runs : 0), 0);
    const moved = rows.reduce((n, r) => n + r.moved, 0);
    out.push(
      `#### ${name}`,
      '',
      `${files.length} records · ${identical} byte-identical · ${differ} differ · ${missing} missing · ${strings.length} with other strings · ${moved} of ${runs} runs (in records that differ, same strings) moved, resized or rewrapped beyond ${MOVE_PX}px`,
      ''
    );
    if (rows.length) {
      out.push(
        '| Record | Same strings | Runs | Moved | Line count changed | Max dx | Max dy | Max width change | Same element count | Max element edge move | Same families | Faces not loaded |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
      );
      for (const r of rows)
        out.push(
          `| ${r.f.replace(/\.boxes\.json$/, '')} | ${r.sameStrings ? 'yes' : '**no**'} | ${r.runs} | ${r.moved} | ${r.lines} | ${r.maxDx} | ${r.maxDy} | ${r.maxDw} | ${r.sameElements ? 'yes' : '**no**'} | ${r.maxBox} | ${r.sameFamilies ? 'yes' : 'no'} | ${r.notLoaded} |`
        );
      out.push('');
    }
  }
  return `${out.join('\n')}\n`;
}

/**
 * Collector timings of each folder, summarised (median, p95, max ms per page).
 * @param {string[]} dirs
 */
export function timingTable(dirs) {
  const out = [
    '| Where | Pages | Median ms | p95 ms | Max ms |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const d of dirs) {
    let t;
    try {
      t = Object.values(
        /** @type {Record<string, number>} */ (
          JSON.parse(readFileSync(join(d, 'timings.json'), 'utf8'))
        )
      );
    } catch {
      continue;
    }
    t.sort((a, b) => a - b);
    const at = (/** @type {number} */ q) => t[Math.min(t.length - 1, Math.floor(q * t.length))];
    out.push(
      `| ${d.split(/[\\/]/).pop()} | ${t.length} | ${at(0.5)} | ${at(0.95)} | ${t.at(-1)} |`
    );
  }
  return `${out.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'render') {
    const out = flag(args, '--out');
    if (!out) {
      console.error(
        'usage: text-determinism.mjs render --out <dir> [--build <dir>] [--font <woff2>]'
      );
      process.exit(2);
    }
    const build = flag(args, '--build');
    const font = flag(args, '--font');
    const n = await render({
      out: resolve(out),
      build: build ? resolve(build) : null,
      font: font ? resolve(font) : null,
    }).catch((e) => {
      console.error(`[text] ${/** @type {Error} */ (e).message}`);
      process.exit(1);
    });
    console.log(`[text] ${n} pages${build ? ' and the dashboard screens' : ''} recorded in ${out}`);
  } else if (cmd === 'compare') {
    const md = flag(args, '--md');
    const dirs = args
      .filter((a, i) => a !== '--md' && args[i - 1] !== '--md')
      .map((d) => resolve(d));
    if (dirs.length < 2) {
      console.error('usage: text-determinism.mjs compare <dir> <dir>… [--md <file>]');
      process.exit(2);
    }
    const text = `${compare(dirs)}\n#### Collector time per page (Node)\n\n${timingTable(dirs)}`;
    process.stdout.write(text);
    if (md) appendFileSync(md, text);
  } else {
    console.error('usage: text-determinism.mjs render … | compare …');
    process.exit(2);
  }
}
