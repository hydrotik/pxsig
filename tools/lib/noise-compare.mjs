/**
 * noise-compare.mjs — `tools/gate-noise.mjs compare`: the engine's verdicts on renders of the same
 * content, and how close they come to each rule. The first render of a pair becomes a throwaway
 * baseline (`pxsig baseline`, in a scratch folder, never a store); the second is checked against it
 * with today's rules (the gate without the color rule), with the color rule alone (every other rule
 * opened wide, so its measurements are on every row) at its own values and at two lower lines, and
 * with the whole gate. Every failure is a false positive.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * @typedef {{ grid: number, minCellPx: number | null, detail: boolean, gate: Record<string, unknown> }} Settings
 * @typedef {{ label: string, platform: string, arch: string, node: string, chromium: string | null, gpu: string | null, dir: string }} Machine
 * @typedef {{ deltaE: number, minArea: number, cellDeltaE: number, minCells: number }} ColorGate
 * @typedef {{
 *   id: string, pass?: boolean, error?: string | null, reasons?: string[],
 *   metrics?: { ssim?: number, changedCells?: number, changedCellsPct?: number, maxCellDiff?: number } | null,
 *   detail?: { changedTiles?: number, newEdgeTiles?: number, maxBlockDelta?: number } | null,
 *   color?: { flatArea?: number | null, flatDeltaE?: number, cells?: number | null, maxCellDeltaE?: number } | null
 * }} Row
 */

/** The color rule's own values, then two lower lines: how close same-content noise comes to it. */
const COLOR_LINES = [
  { deltaE: 3, minArea: 64, cellDeltaE: 5, minCells: 3 },
  { deltaE: 2, minArea: 64, cellDeltaE: 3, minCells: 3 },
  { deltaE: 1, minArea: 64, cellDeltaE: 2, minCells: 3 },
];
/** Every rule but the color rule opened wide. */
const OPEN = { minSsim: 0, maxChangedPct: 100, minCells: 0, detail: false };

/** Renders only: not the diff, baseline or heat images a check writes beside them. */
export const isRender = (/** @type {string} */ f) =>
  f.endsWith('.png') && !/\.(diff|baseline|current|heat)\.png$/.test(f);
/** @param {string} dir */
export const pngs = (dir) => (existsSync(dir) ? readdirSync(dir).filter(isRender) : []);
/** @template T @param {string} f @returns {T} */
const readJson = (f) => /** @type {T} */ (JSON.parse(readFileSync(f, 'utf8')));
const hash = (/** @type {string} */ f) =>
  createHash('sha256').update(readFileSync(f)).digest('hex');
/** @param {Row[]} rows */
const failing = (rows) => rows.filter((r) => r.pass !== true);
/** @param {Row[]} rows @param {(r: Row) => number | null | undefined} f */
const max = (rows, f) => rows.reduce((m, r) => Math.max(m, f(r) ?? 0), 0);

/**
 * The engine's rows for the renders in `b`, checked against baselines made from `a`, per gate.
 * @param {string} bin
 * @param {string} a
 * @param {string} b
 * @param {string[]} ids
 * @param {Settings} s
 * @param {Record<string, Record<string, unknown>>} gates
 * @returns {Record<string, Row[]>}
 */
function engineRows(bin, a, b, ids, s, gates) {
  const scratch = mkdtempSync(join(tmpdir(), 'pxsig-noise-'));
  try {
    const stories = ids.map((id) => ({ id, sig: `sigs/${id}.psig` }));
    const manifest = (/** @type {Record<string, unknown>} */ gate) => {
      const f = join(scratch, 'm.json');
      const { grid, minCellPx, detail } = s;
      writeFileSync(f, JSON.stringify({ version: 2, grid, minCellPx, detail, gate, stories }));
      return f;
    };
    /** @param {string[]} args @returns {unknown} */
    const run = (args) => {
      const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 30 });
      if (r.status === 2 || r.error)
        throw new Error(`pxsig ${args[0]} → ${r.status}\n${r.stderr}${r.error?.message ?? ''}`);
      return JSON.parse(r.stdout);
    };
    run(['baseline', '--manifest', manifest(s.gate), '--png-dir', a, '--root', scratch, '--json']);
    /** @type {Record<string, Row[]>} */
    const out = {};
    for (const [name, gate] of Object.entries(gates)) {
      const args = ['--png-dir', b, '--root', scratch, '--json', '--artifacts', 'none'];
      // `check --json`: `{ summary, results }`, one row per entry.
      out[name] = /** @type {{ results: Row[] }} */ (
        run(['check', '--manifest', manifest(gate), ...args])
      ).results;
    }
    return out;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * One scenario: the renders of B against baselines from the renders of A.
 * @param {string} bin
 * @param {string} from
 * @param {string} suite
 * @param {string} kind
 * @param {{ m: Machine, run: string }} A
 * @param {{ m: Machine, run: string }} B
 */
function scenario(bin, from, suite, kind, A, B) {
  const da = join(from, A.m.dir, suite, A.run);
  const db = join(from, B.m.dir, suite, B.run);
  const ids = pngs(da)
    .filter((f) => existsSync(join(db, f)))
    .map((f) => f.slice(0, -4));
  /** @type {Settings} */
  const s = readJson(join(from, A.m.dir, suite, 'settings.json'));
  const own = s.gate.color && typeof s.gate.color === 'object' ? s.gate.color : null;
  const color = /** @type {ColorGate} */ (own ?? COLOR_LINES[0]);
  const lines = [color, ...COLOR_LINES.slice(1)];
  /** @type {Record<string, Record<string, unknown>>} */
  const gates = {
    today: { ...s.gate, color: false },
    gate: { ...s.gate, color },
    ...Object.fromEntries(lines.map((c, i) => [`color${i}`, { ...s.gate, ...OPEN, color: c }])),
  };
  const rows = engineRows(bin, da, db, ids, s, gates);
  /** @param {string} k */
  const fp = (k) => ({
    count: failing(rows[k]).length,
    ids: failing(rows[k])
      .slice(0, 8)
      .map((r) => `${r.id}: ${(r.reasons?.length ? r.reasons : [r.error ?? '']).join('; ')}`),
  });
  const t = rows.today;
  return {
    suite,
    kind,
    a: `${A.m.label}/${A.run}`,
    b: `${B.m.label}/${B.run}`,
    platform: `${A.m.platform}-${A.m.arch}`,
    entries: ids.length,
    differ: ids.filter((id) => hash(join(da, `${id}.png`)) !== hash(join(db, `${id}.png`))).length,
    fp: { today: fp('today'), color: fp('color0'), gate: fp('gate') },
    // How close the same content comes to each rule (higher is closer, except SSIM).
    margins: {
      minSsim: t.reduce((m, r) => Math.min(m, r.metrics?.ssim ?? 1), 1),
      maxChangedCells: max(t, (r) => r.metrics?.changedCells),
      maxChangedPct: max(t, (r) => r.metrics?.changedCellsPct),
      maxCellDiff: max(t, (r) => r.metrics?.maxCellDiff),
      maxDetailTiles: max(t, (r) => (r.detail?.changedTiles ?? 0) + (r.detail?.newEdgeTiles ?? 0)),
      maxBlockDelta: max(t, (r) => r.detail?.maxBlockDelta),
      color: lines.map((c, i) => {
        const cr = rows[`color${i}`];
        /** @type {Row | null} */
        let flat = null;
        for (const r of cr) if ((r.color?.flatArea ?? 0) > (flat?.color?.flatArea ?? 0)) flat = r;
        return {
          deltaE: c.deltaE,
          cellDeltaE: c.cellDeltaE,
          maxFlatArea: flat?.color?.flatArea ?? 0,
          flatDeltaE: flat?.color?.flatDeltaE ?? 0,
          maxCells: max(cr, (r) => r.color?.cells),
          maxCellDeltaE: max(cr, (r) => r.color?.maxCellDeltaE),
          fails: failing(cr).length,
        };
      }),
    },
  };
}
/** @typedef {ReturnType<typeof scenario>} Scenario */

/**
 * Every scenario under `from`: each machine's run1 against its run2, and run1 of each pair of
 * machines with the same OS and architecture.
 * @param {string} bin
 * @param {string} from
 */
export function compareAll(bin, from) {
  /** @type {Machine[]} */
  const machines = readdirSync(from)
    .filter((d) => existsSync(join(from, d, 'meta.json')))
    .map((d) => {
      /** @type {Machine} */
      const m = readJson(join(from, d, 'meta.json'));
      return { ...m, dir: d };
    });
  /** @type {Scenario[]} */
  const scenarios = [];
  for (const suite of ['example', 'dashboard']) {
    const have = machines.filter((m) => existsSync(join(from, m.dir, suite, 'run1')));
    for (const m of have)
      if (existsSync(join(from, m.dir, suite, 'run2')))
        scenarios.push(
          scenario(bin, from, suite, 'same machine', { m, run: 'run1' }, { m, run: 'run2' })
        );
    for (let i = 0; i < have.length; i++)
      for (let j = i + 1; j < have.length; j++)
        if (have[i].platform === have[j].platform && have[i].arch === have[j].arch)
          scenarios.push(
            scenario(
              bin,
              from,
              suite,
              'machine to machine',
              { m: have[i], run: 'run1' },
              { m: have[j], run: 'run1' }
            )
          );
  }
  return {
    generatedAt: new Date().toISOString(),
    engine: spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout.trim(),
    machines: machines.map(({ dir: _dir, ...m }) => m),
    scenarios,
  };
}

/** @param {ReturnType<typeof compareAll>} r */
export function markdown(r) {
  const fx = (/** @type {number} */ x, /** @type {number} */ d) => x.toFixed(d);
  const lines = [
    `### Gate noise: false positives on renders of the same content (${r.engine})`,
    '',
    '| Machine | OS | Chromium | GPU |',
    '|---|---|---|---|',
    ...r.machines.map(
      (m) => `| ${m.label} | ${m.platform}-${m.arch} | ${m.chromium ?? '—'} | ${m.gpu ?? '—'} |`
    ),
    '',
    'Entries that fail, of entries compared; every one is the same content. Today: the gate without the color rule. Color: the color rule alone. Gate: both.',
    '',
    '| Suite | Scenario | A → B | Entries | Renders differ | FP today | FP color | FP gate | min SSIM | max changed cells | max cell Δ | max detail tiles |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...r.scenarios.map((s) => {
      const m = s.margins;
      return `| ${s.suite} | ${s.kind} | ${s.a} → ${s.b} | ${s.entries} | ${s.differ} | ${s.fp.today.count} | ${s.fp.color.count} | ${s.fp.gate.count} | ${fx(m.minSsim, 5)} | ${m.maxChangedCells} | ${fx(m.maxCellDiff, 1)} | ${m.maxDetailTiles} |`;
    }),
    '',
    'The color rule on the same content: the largest connected flat area whose color changed by at least the ΔE00 shown (the rule fails at 64 px), and the most cells whose mean color changed by at least the cell ΔE00 shown (it fails at 3), at the rule’s own values and two lower lines.',
    '',
    '| Suite | A → B | flat px ΔE ≥ 3 · cells ΔE ≥ 5 | flat px ΔE ≥ 2 · cells ΔE ≥ 3 | flat px ΔE ≥ 1 · cells ΔE ≥ 2 | max cell ΔE00 |',
    '|---|---|---:|---:|---:|---:|',
    ...r.scenarios.map((s) => {
      const c = s.margins.color;
      return `| ${s.suite} | ${s.a} → ${s.b} | ${c.map((x) => `${x.maxFlatArea} · ${x.maxCells}`).join(' | ')} | ${fx(c[0].maxCellDeltaE, 2)} |`;
    }),
    '',
  ];
  const fps = r.scenarios.flatMap((s) =>
    [...s.fp.today.ids.map((x) => `today ${x}`), ...s.fp.color.ids.map((x) => `color ${x}`)].map(
      (x) => `- ${s.suite} ${s.a} → ${s.b}: ${x}`
    )
  );
  if (fps.length)
    lines.push('<details><summary>False positives</summary>', '', ...fps, '', '</details>', '');
  return `${lines.join('\n')}\n`;
}
