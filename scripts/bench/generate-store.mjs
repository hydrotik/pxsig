#!/usr/bin/env node
/**
 * generate-store.mjs — a synthetic project at hydrotik's size, for the scale benchmark (run.mjs).
 *
 *   node scripts/bench/generate-store.mjs <dir> [--seed 1]
 *
 * Writes a git repository with one pxsig project: about 1,000 code files under `src` with an
 * import graph, 168 story files with 537 stories, a main manifest of 1,074 entries (dark, light)
 * and a matrix suite of 1,668 (lime, mobile, firefox, webkit), one small `.psig` and one render
 * per entry, the approval log, a11y.json, both reports and a run history. A second commit edits a
 * component, one baseline and the log, so `affected --since HEAD~1` has a real diff. The same
 * seed gives the same tree. Sizes are hydrotik's on 2026-10-25 (SIZE below).
 *
 * Needs the Rust engine (`cargo build --release`, or PXSIG_BIN) for one template `.psig`; every
 * other baseline is that template with its own entry id.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { storyNameFromExport, toId } from '../../packages/pxsig/src/lib/integrity.mjs';
import { rustBinary } from '../../packages/pxsig/src/lib/workspace.mjs';

export const SIZE = {
  components: 168, // story files, one per component folder
  stories: 537, // main manifest: × 2 modes = 1,074 entries
  matrixStories: 417, // matrix suite: × 4 modes = 1,668 entries
  internal: 150, // shared modules under src/internal
  hooks: 30,
  changed: 12, // failing rows in the main report (what `approve plan` classifies)
  a11yAccepted: 374, // entries with a non-empty accepted list
  extraApprovals: 293, // re-approvals on top of one line per entry (3,035 lines)
  historyRuns: 442, // lines in reports/history.ndjson
};
const MAIN_MODES = ['dark', 'light'];
const MATRIX_MODES = ['lime', 'mobile', 'firefox', 'webkit'];
const VARIANTS = ['Default', 'Primary', 'Secondary', 'Outline', 'Ghost', 'Small', 'Large', 'Disabled', 'Loading', 'WithIcon', 'Compact', 'Dense', 'Empty', 'Invalid'];
const RULES = ['color-contrast', 'region', 'aria-allowed-role', 'landmark-unique', 'nested-interactive', 'scrollable-region-focusable'];

/** mulberry32: small, seeded, the same sequence on every OS. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- a tiny PNG (no dependencies) ---------------------------------------------------------------
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      raw.set([r, g, b, 255], y * (w * 4 + 1) + 1 + x * 4);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const IMAGE = png(128, 128, (x, y) => (((x >> 4) + (y >> 4)) % 2 ? [230, 230, 230] : [40, 60, 90]));
const CHANGED = png(128, 128, (x, y) => (x > 24 && x < 104 && y > 24 && y < 104 ? [220, 20, 20] : ((x >> 4) + (y >> 4)) % 2 ? [230, 230, 230] : [40, 60, 90]));

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** One real `.psig` from the engine, split so each entry's copy only changes the header's id. */
function template(bin, scratch) {
  const pngPath = join(scratch, 't.png');
  writeFileSync(pngPath, IMAGE);
  const run = (args) => {
    const r = spawnSync(bin, args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${bin} ${args[0]}: ${r.stderr || r.error?.message}`);
  };
  run(['capture', pngPath, '--out', join(scratch, 't.json'), '--grid', '16']);
  run(['pack', join(scratch, 't.json'), '--out', join(scratch, 't.psig'), '--entry', '{"id":"t"}', '--image', pngPath]);
  const buf = readFileSync(join(scratch, 't.psig'));
  const len = buf.readUInt32LE(6);
  return { header: JSON.parse(buf.subarray(10, 10 + len).toString('utf8')), body: buf.subarray(10 + len) };
}
function psig(t, id, createdAt = t.header.record?.createdAt) {
  const header = Buffer.from(JSON.stringify({ ...t.header, entry: { id }, record: { ...t.header.record, createdAt } }));
  const pre = Buffer.alloc(10);
  pre.write('PSIG', 0, 'latin1');
  pre.writeUInt16LE(t.header.container ?? 1, 4);
  pre.writeUInt32LE(header.length, 6);
  return Buffer.concat([pre, header, t.body]);
}

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'bench', GIT_AUTHOR_EMAIL: 'bench@example.com', GIT_COMMITTER_NAME: 'bench', GIT_COMMITTER_EMAIL: 'bench@example.com', GIT_AUTHOR_DATE: '2026-10-25T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-25T00:00:00Z' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/**
 * Write the project into `dir` (created; must not exist or be empty). Returns what the runner
 * needs: the counts and a few ids.
 */
export function generateStore(dir, { seed = 1, bin = process.env.PXSIG_BIN || rustBinary() } = {}) {
  if (!existsSync(bin)) throw new Error(`the pxsig engine is missing (${bin}): cargo build --release, or set PXSIG_BIN`);
  const rand = rng(seed);
  const pick = (n) => Math.floor(rand() * n);
  mkdirSync(dir, { recursive: true });
  const w = (rel, data) => {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  };
  const scratch = mkdtempSync(join(tmpdir(), 'pxsig-bench-t-'));
  const t = template(bin, scratch);
  rmSync(scratch, { recursive: true, force: true });

  // --- source tree ------------------------------------------------------------------------------
  w('package.json', JSON.stringify({ name: 'bench-ds', private: true, type: 'module' }, null, 2));
  w('node_modules/@storybook/react/package.json', '{"name":"@storybook/react"}');
  w('node_modules/react/package.json', '{"name":"react"}');
  w('.gitignore', 'node_modules/\n.pxsig/renders/\n.pxsig/reports/\n.pxsig/history/\n.pxsig/.lock\n');
  for (let i = 0; i < SIZE.internal; i++) {
    const deps = [...new Set(Array.from({ length: i ? 1 + pick(3) : 0 }, () => pick(i)))];
    w(`src/internal/util${i}.ts`, `${deps.map((d) => `import { util${d} } from './util${d}';`).join('\n')}\nexport const util${i} = (x: number) => x + ${i}${deps.map((d) => ` + util${d}(0)`).join('')};\n`);
  }
  for (let i = 0; i < SIZE.hooks; i++) w(`src/hooks/useHook${i}.ts`, `import { util${pick(SIZE.internal)} } from '../internal/util${pick(SIZE.internal)}';\nexport const useHook${i} = () => ${i};\n`);
  const names = Array.from({ length: SIZE.components }, (_, i) => `Comp${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`);
  // Stories per component: 537 over 168 files, at least one each.
  const per = names.map(() => 1);
  for (let left = SIZE.stories - names.length; left > 0; left--) {
    let k = pick(names.length);
    while (per[k] >= VARIANTS.length) k = (k + 1) % names.length;
    per[k]++;
  }
  const main = [];
  const matrix = [];
  let matrixLeft = SIZE.matrixStories;
  names.forEach((name, i) => {
    const folder = `src/components/${name}`;
    const utils = [...new Set(Array.from({ length: 2 + pick(3) }, () => pick(SIZE.internal)))];
    const peers = i ? [...new Set(Array.from({ length: pick(3) }, () => pick(i)))] : [];
    w(`${folder}/${name}.css.ts`, `export const root = { padding: ${i} };\n`);
    w(
      `${folder}/${name}.tsx`,
      [`import * as React from 'react';`, `import { root } from './${name}.css';`, `import { useHook${pick(SIZE.hooks)} } from '../../hooks/useHook${pick(SIZE.hooks)}';`, ...utils.map((u) => `import { util${u} } from '../../internal/util${u}';`), ...peers.map((p) => `import { ${names[p]} } from '../${names[p]}';`), `export const ${name} = () => null;`, ''].join('\n'),
    );
    w(`${folder}/index.ts`, `export * from './${name}';\n`);
    w(`${folder}/${name}.test.tsx`, `import { ${name} } from './${name}';\ntest('${name}', () => ${name});\n`);
    w(`${folder}/${name}.llm-context.md`, `# ${name}\n\nSynthetic.\n`);
    const variants = VARIANTS.slice(0, per[i]);
    const title = `Components/${name}`;
    w(`${folder}/${name}.stories.tsx`, `import type { Meta, StoryObj } from '@storybook/react';\nimport { ${name} } from './${name}';\nconst meta = { title: '${title}', component: ${name} } satisfies Meta;\nexport default meta;\ntype Story = StoryObj<typeof meta>;\n${variants.map((v) => `export const ${v}: Story = {};`).join('\n')}\n`);
    for (const v of variants) {
      const story = toId(title, storyNameFromExport(v));
      const entry = (mode, def) => ({
        id: def ? story : `${story}@${mode}`,
        story,
        mode,
        state: null,
        sig: `.pxsig/baselines/components/${name}/${def ? story : `${story}@${mode}`}.psig`,
        importPath: `${folder}/${name}.stories.tsx`,
        globals: `theme:${mode === 'light' ? 'light' : 'dark'};colorway:${mode === 'lime' ? 'lime' : 'default'}`,
        colorScheme: mode === 'light' ? 'light' : 'dark',
        viewport: mode === 'mobile' ? [390, 844] : [900, 600],
        browser: mode === 'firefox' || mode === 'webkit' ? mode : 'chromium',
        a11y: true,
      });
      for (const m of MAIN_MODES) main.push(entry(m, m === 'dark'));
      if (matrixLeft > 0) {
        matrixLeft--;
        for (const m of MATRIX_MODES) matrix.push(entry(m, false));
      }
    }
  });
  w('src/index.ts', names.map((n) => `export * from './components/${n}';`).join('\n') + '\n');

  // --- project config ---------------------------------------------------------------------------
  const config = {
    version: 1,
    name: 'bench',
    srcRoot: 'src',
    storybook: { url: 'http://127.0.0.1:9' },
    store: { dir: '.pxsig', layout: 'package' },
    grid: 16,
    minCellPx: null,
    detail: false,
    gate: { threshold: 24, minCells: 3, minSsim: 0.99, maxChangedPct: 2 },
    modes: {
      dark: { globals: 'theme:dark;colorway:default', colorScheme: 'dark' },
      light: { globals: 'theme:light;colorway:default', colorScheme: 'light' },
      lime: { globals: 'theme:dark;colorway:lime', colorScheme: 'dark' },
      mobile: { extends: 'dark', viewport: [390, 844] },
      firefox: { extends: 'dark', browser: 'firefox' },
      webkit: { extends: 'dark', browser: 'webkit' },
    },
    defaultMode: 'dark',
    modesByDefault: MAIN_MODES,
    suites: { matrix: { modes: MATRIX_MODES } },
    nonVisual: [],
    a11y: true,
  };
  w('pxsig.config.json', JSON.stringify(config, null, 2));

  // --- store ------------------------------------------------------------------------------------
  const all = [...main, ...matrix];
  w('.pxsig/manifest.json', JSON.stringify({ version: 2, project: 'bench', skipped: [], stories: main }, null, 2));
  w('.pxsig/manifest.matrix.json', JSON.stringify({ version: 2, project: 'bench', suite: 'matrix', skipped: [], stories: matrix }, null, 2));
  w('.pxsig/.gitattributes', '*.psig binary\n');
  const after = {};
  for (const e of all) {
    const buf = psig(t, e.id);
    w(e.sig, buf);
    after[e.id] = sha(buf);
  }
  const changed = new Set();
  while (changed.size < SIZE.changed) changed.add(main[pick(main.length)].id);
  for (const e of all) w(`.pxsig/renders/latest/${e.id}.png`, changed.has(e.id) ? CHANGED : IMAGE);
  // The log: one line per entry, then re-approvals; `after` of an entry's last line is its bytes.
  const lines = [];
  const at0 = Date.parse('2026-10-18T00:00:00Z');
  all.forEach((e, i) => lines.push({ at: new Date(at0 + i * 1000).toISOString(), id: e.id, via: 'dashboard', batch: `b${Math.floor(i / 40)}`, reason: null, kind: null, gitHead: '0000000', before: null, after: after[e.id], pxsig: '0.4.0' }));
  for (let k = 0; k < SIZE.extraApprovals; k++) {
    const e = all[pick(all.length)];
    lines.push({ at: new Date(at0 + (all.length + k) * 1000).toISOString(), id: e.id, via: 'cli', batch: `r${Math.floor(k / 10)}`, reason: 'bench', kind: null, gitHead: '0000000', before: after[e.id], after: after[e.id], pxsig: '0.4.0' });
  }
  w('.pxsig/approvals.ndjson', lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const a11y = {};
  for (const e of all) a11y[e.id] = [];
  for (let k = 0; k < SIZE.a11yAccepted; k++) a11y[all[pick(all.length)].id] = [RULES[pick(RULES.length)]];
  w('.pxsig/a11y.json', JSON.stringify(a11y, null, 2));

  // --- reports ----------------------------------------------------------------------------------
  const checkedAt = new Date(Date.now() - 60_000).toISOString();
  const row = (e) => {
    const bad = changed.has(e.id);
    return {
      id: e.id,
      story: e.story,
      mode: e.mode,
      state: null,
      gate: config.gate,
      pass: !bad,
      metrics: bad ? { ssim: 0.82, matchScore: 70, changedCellsPct: 14, changedCells: 36, grid: 16, threshold: 24 } : { ssim: 1, matchScore: 100, changedCellsPct: 0, changedCells: 0, identical: true, grid: 16, threshold: 24 },
      reasons: bad ? ['ssim 0.82 < min 0.99'] : [],
      note: bad ? 'changed' : 'pass',
      cached: !bad,
      render: sha(bad ? CHANGED : IMAGE),
      browser: e.browser,
      globals: e.globals,
      changed: bad,
      error: null,
      renderMs: 900 + pick(400),
      checkedAt,
      a11y: { violations: a11y[e.id].map((id) => ({ id, impact: 'serious' })), new: 0, baseline: a11y[e.id] },
    };
  };
  const report = (entries, suite) => ({
    generatedAt: checkedAt,
    project: 'bench',
    ...(suite ? { suite } : {}),
    summary: { entries: entries.length, checked: entries.length, skipped: 0, passed: entries.length - (suite ? 0 : SIZE.changed), failed: suite ? 0 : SIZE.changed, flaky: 0, new: 0, errors: 0, modes: suite ? MATRIX_MODES : MAIN_MODES },
    affected: null,
    rows: entries.map(row),
    fullCheckAt: checkedAt,
  });
  w('.pxsig/reports/check.json', JSON.stringify(report(main)));
  w('.pxsig/reports/check-matrix.json', JSON.stringify(report(matrix, 'matrix')));
  const hist = [];
  for (let k = 0; k < SIZE.historyRuns; k++) hist.push(JSON.stringify({ at: new Date(at0 + k * 600_000).toISOString(), summary: { stories: main.length, failed: k % 7 ? 0 : 2 }, rows: Object.fromEntries(main.map((e) => [e.id, [1, 1.0, 0, 0]])) }));
  w('.pxsig/reports/history.ndjson', hist.join('\n') + '\n');

  // --- git: the tree, then one pull request's worth of edits --------------------------------------
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const edited = names[pick(names.length)];
  const edits = [`src/components/${edited}/${edited}.tsx`, `src/internal/util${pick(SIZE.internal)}.ts`];
  w(edits[0], readFileSync(join(dir, edits[0]), 'utf8') + `// edited\n`);
  w(edits[1], `export const touched = 1;\n`);
  const rebaselined = main[pick(main.length)];
  const newBytes = psig(t, rebaselined.id, '2026-10-25T00:00:00.000Z');
  w(rebaselined.sig, newBytes);
  w('.pxsig/approvals.ndjson', readFileSync(join(dir, '.pxsig/approvals.ndjson'), 'utf8') + JSON.stringify({ at: '2026-10-25T00:00:00Z', id: rebaselined.id, via: 'dashboard', batch: 'pr', reason: null, kind: null, gitHead: '0000000', before: after[rebaselined.id], after: sha(newBytes), pxsig: '0.4.0' }) + '\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'edit');
  // Sources and renders predate the verdicts, except this pull request's two edits: `doctor` then
  // sees what a project looks like an hour after a full check, not 1,074 stale verdicts.
  const old = new Date(Date.now() - 3_600_000);
  const age = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) age(p);
      else utimesSync(p, old, old);
    }
  };
  age(join(dir, 'src'));
  age(join(dir, '.pxsig', 'renders'));
  const now = new Date();
  for (const f of edits) utimesSync(join(dir, f), now, now);

  return { dir, entries: main.length, matrix: matrix.length, renders: all.length, storyFiles: names.length, changed: [...changed], edited };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const seedAt = args.indexOf('--seed');
  if (!dir) {
    console.error('usage: node scripts/bench/generate-store.mjs <dir> [--seed 1]');
    process.exit(2);
  }
  const r = generateStore(resolve(dir), { seed: seedAt >= 0 ? Number(args[seedAt + 1]) : 1 });
  console.log(`[bench] ${r.dir}: ${r.entries} entries, ${r.matrix} in the matrix suite, ${r.renders} renders, ${r.storyFiles} story files`);
}
