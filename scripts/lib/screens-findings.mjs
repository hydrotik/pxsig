/**
 * screens-findings.mjs — what a screens run found, by kind (scripts/screens-check.mjs), and the
 * advisory comparison of a project's structure with another project's locks.
 *
 * `findingsReport` writes the store's reports/findings.json and findings.md: each strict finding
 * (axe, layout, alignment, fidelity, top-bar), each unstable screen, each structure or geometry
 * problem (a lock that is missing kept apart from one that changed), and then the entries against
 * their baselines (changed, new: no baseline, not rendered), so a run with no baselines yet still
 * shows its findings apart from the entries that only need a first approval. It decides nothing:
 * the verdict stays screens-check's.
 *
 * `ariaVsReference` writes reports/aria-vs-reference.md: each screen whose accessibility snapshot
 * in this run differs from the one committed in `reference` (the reference store's locks), with the
 * first line that differs. Advisory: it never fails; an adapter may wrap its own elements.
 *
 * Zero dependencies.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstDifference } from './screen-locks.mjs';

/** @import { CheckRow } from '../../packages/pxsig/src/types.js' */
/** @typedef {{ kind: string, id: string, text: string }} Finding */
/**
 * @typedef {{ rendered: boolean, axe: { id: string, count: number }[], layout: { rule: string, text: string }[],
 *   alignment?: { rule: string, text: string }[], fidelity?: { rule: string, text: string }[] }} Screen
 */

const MISSING = /: (no locked structure|anchor \S+ is not locked)$/;

/**
 * Every finding of a run, by kind, in the order the kinds are listed.
 * @template {Screen} S
 * @param {{ screens: S[], idOf: (s: S) => string, topBar?: { findings: { rule: string, text: string }[] } | null,
 *   unstable?: string[], structure?: string[], geometry?: string[] }} o
 * @returns {Finding[]}
 */
export function runFindings({
  screens,
  idOf,
  topBar = null,
  unstable = [],
  structure = [],
  geometry = [],
}) {
  /** @type {Finding[]} */
  const out = [];
  const each = (/** @type {string} */ kind, /** @type {(s: S) => string[]} */ texts) => {
    for (const s of screens)
      if (s.rendered) for (const text of texts(s)) out.push({ kind, id: idOf(s), text });
  };
  each('axe', (s) => s.axe.map((v) => `${v.id} (${v.count})`));
  each('layout', (s) => s.layout.map((l) => `${l.rule}: ${l.text}`));
  each('alignment', (s) => (s.alignment ?? []).map((l) => `${l.rule}: ${l.text}`));
  each('fidelity', (s) => (s.fidelity ?? []).map((l) => `${l.rule}: ${l.text}`));
  for (const f of topBar?.findings ?? []) out.push({ kind: 'top-bar', id: f.rule, text: f.text });
  for (const u of unstable) out.push({ kind: 'unstable', id: '', text: u });
  for (const [kind, list] of /** @type {const} */ ([
    ['structure', structure],
    ['geometry', geometry],
  ]))
    for (const p of list)
      out.push({ kind: MISSING.test(p) ? `${kind} (not locked yet)` : kind, id: '', text: p });
  return out;
}

/**
 * Write reports/findings.json and findings.md.
 * @param {{ reports: string, project: string, findings: Finding[], gated: string[],
 *   rows: CheckRow[] }} o
 *   gated: the kinds that fail this project's check
 */
export function writeFindings({ reports, project, findings, gated, rows }) {
  const ran = rows.filter((r) => !r.skipped);
  const entries = {
    changed: ran.filter((r) => !r.error && !r.pass && !r.new).map((r) => r.id),
    new: ran.filter((r) => !r.error && !r.pass && r.new).map((r) => r.id),
    error: ran.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`),
  };
  /** @type {Map<string, Finding[]>} */
  const byKind = new Map();
  for (const f of findings) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  mkdirSync(reports, { recursive: true });
  writeFileSync(
    join(reports, 'findings.json'),
    `${JSON.stringify({ project, gated, findings, entries }, null, 2)}\n`
  );
  const lines = [`## Findings (${project})`, ''];
  if (!byKind.size) lines.push('No finding on any screen.', '');
  for (const [kind, list] of byKind) {
    const note = gated.some((g) => kind.startsWith(g)) ? '' : ' (advisory here)';
    lines.push(`### ${kind}: ${list.length}${note}`, '');
    for (const f of list.slice(0, 200))
      lines.push(`- ${f.id ? `${f.id}: ` : ''}${f.text}`.slice(0, 400));
    if (list.length > 200) lines.push(`- … ${list.length - 200} more in reports/findings.json`);
    lines.push('');
  }
  lines.push(
    '### Entries against their baselines',
    '',
    `- changed: ${entries.changed.length}`,
    `- new: no baseline: ${entries.new.length}`,
    `- not rendered: ${entries.error.length}`,
    ...entries.error.slice(0, 50).map((e) => `  - ${e}`),
    ''
  );
  writeFileSync(join(reports, 'findings.md'), lines.join('\n'));
}

/**
 * Compare this run's structure files (`current`, reports/structure/) with `reference`'s locks;
 * write reports/aria-vs-reference.md; return the line to print. Never fails.
 * @param {{ current: string, reference: string, reports: string, project: string }} o
 */
export function ariaVsReference({ current, reference, reports, project }) {
  /** @type {string[]} */
  const differ = [];
  /** @type {string[]} */
  const unmatched = [];
  let same = 0;
  if (existsSync(current))
    for (const section of readdirSync(current, { withFileTypes: true }).filter((d) =>
      d.isDirectory()
    ))
      for (const name of readdirSync(join(current, section.name)).filter((n) =>
        n.endsWith('.aria.yml')
      )) {
        const file = `${section.name}/${name}`;
        const ref = join(reference, file);
        if (!existsSync(ref)) {
          unmatched.push(file);
          continue;
        }
        const a = readFileSync(ref, 'utf8');
        const b = readFileSync(join(current, file), 'utf8');
        if (a === b) same++;
        else differ.push(`${file}: ${firstDifference(a, b)}`);
      }
  const lines = [
    `## Structure of ${project} against the reference's locks (advisory)`,
    '',
    `${same} screens the same, ${differ.length} differ, ${unmatched.length} with no reference lock. This never fails.`,
    '',
    ...differ.map((d) => `- ${d}`),
    ...unmatched.map((u) => `- ${u}: no reference lock`),
    '',
  ];
  mkdirSync(reports, { recursive: true });
  writeFileSync(join(reports, 'aria-vs-reference.md'), lines.join('\n'));
  return `[screens] structure against the reference (advisory): ${same} the same, ${differ.length} differ: reports/aria-vs-reference.md`;
}
