/**
 * screen-locks.mjs — the locked structure and geometry of pxsig's own dashboard screens
 * (scripts/screens-check.mjs).
 *
 * Each screen's accessibility snapshot (Playwright's `ariaSnapshot`: roles, names, states, order) is
 * committed as text, one file per screen: packages/dashboard/fixtures/locked/<section>/<name>-<n>.aria.yml.
 * A theme changes colours, never structure, so every theme of a screen must give the same snapshot.
 * A difference fails the check until the file is updated on purpose (`--update-locks`) and the
 * update is read in its commit's diff.
 *
 * Geometry: a feature's anchors (src/ui/features.ts) are each in the same place and size on every
 * screen of that feature where they show, and their boxes are committed in
 * packages/dashboard/fixtures/locked/geometry.json, so a change that moves one everywhere at once
 * fails too.
 *
 * Zero dependencies.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * What may differ between the themes of one screen, each with its reason. Only the comparison of
 * the themes uses them; the committed file keeps the first theme's text as it is.
 * @type {{ pattern: RegExp, as: string, reason: string }[]}
 */
export const THEME_MASKS = [
  {
    pattern: /button "(Light|Dark) theme"/g,
    as: 'button "<theme toggle>"',
    reason: 'the theme toggle names the theme it switches to',
  },
];

/** @param {string} text */
const masked = (text) => THEME_MASKS.reduce((t, m) => t.replace(m.pattern, m.as), text);

/**
 * A screen's structure file, relative to the locked folder: `inspector.header` #2 →
 * `inspector/header-2.aria.yml`.
 * @param {string} feature `<section>.<name>`
 * @param {number} n the screen's number within its feature, from 1
 */
export function structureFile(feature, n) {
  const [section, ...name] = feature.split('.');
  return `${section}/${[...name, String(n)].join('-')}.aria.yml`;
}

/**
 * The first line where two texts differ, as `line N: - old / + new`, for a short report.
 * @param {string} was
 * @param {string} now
 */
export function firstDifference(was, now) {
  const a = was.split('\n');
  const b = now.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (a[i] !== b[i])
      return `line ${i + 1}: - ${a[i] ?? '(nothing)'} / + ${b[i] ?? '(nothing)'}`.slice(0, 300);
  return '';
}

/**
 * Check (or, with `update`, write) the structure of the rendered screens against `dir`.
 * `complete`: every screen of the catalogue was rendered, so a file with no screen is stale.
 * @param {{ screens: { feature: string, index: number, theme: string, aria?: string }[], dir: string, update?: boolean, complete?: boolean }} o
 * @returns {{ problems: string[], written: string[], removed: string[] }}
 */
export function checkStructure({ screens, dir, update = false, complete = false }) {
  /** @type {Map<string, Map<string, string>>} file → theme → snapshot */
  const byFile = new Map();
  for (const s of screens) {
    if (s.aria == null) continue;
    const file = structureFile(s.feature, s.index + 1);
    const themes = byFile.get(file) ?? /** @type {Map<string, string>} */ (new Map());
    themes.set(s.theme, `${s.aria.trimEnd()}\n`);
    byFile.set(file, themes);
  }
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const written = [];
  /** @type {string[]} */
  const removed = [];
  for (const [file, themes] of byFile) {
    // In name order, so the committed text is always the same theme's (dark, of dark and light).
    const [[first, text], ...rest] = [...themes].sort(([a], [b]) => a.localeCompare(b));
    const other = rest.find(([, t]) => masked(t) !== masked(text));
    if (other) {
      problems.push(
        `${file}: the ${first} and ${other[0]} themes differ in structure (${firstDifference(masked(text), masked(other[1]))})`
      );
      continue;
    }
    const path = join(dir, file);
    const was = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (was === text) continue;
    if (update) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      written.push(file);
    } else
      problems.push(
        was == null
          ? `${file}: no locked structure`
          : `${file}: the structure changed (${firstDifference(was, text)})`
      );
  }
  if (complete && existsSync(dir))
    for (const section of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()))
      for (const name of readdirSync(join(dir, section.name)).filter((n) =>
        n.endsWith('.aria.yml')
      )) {
        const file = `${section.name}/${name}`;
        if (byFile.has(file)) continue;
        if (update) {
          rmSync(join(dir, file));
          removed.push(file);
        } else problems.push(`${file}: locked, but no screen has it`);
      }
  return { problems, written, removed };
}

/** @typedef {[number, number, number, number]} Box `[x, y, width, height]`, whole px */
/** @typedef {Record<string, Record<string, Record<string, Box | null>>>} Geometry feature → screen number → anchor → box */

const showBox = (/** @type {Box | null | undefined} */ b) => (b ? `[${b.join(', ')}]` : 'absent');

/**
 * Check (or, with `update`, write) the anchors' boxes against the JSON file `file`.
 * `complete`: every screen was rendered, so a committed feature or screen with none is stale.
 * @param {{ screens: { feature: string, index: number, theme: string, anchors?: Record<string, Box | null> }[], file: string, update?: boolean, complete?: boolean }} o
 * @returns {{ problems: string[], written: boolean, geometry: Geometry }}
 */
export function checkGeometry({ screens, file, update = false, complete = false }) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Geometry} */
  const now = {};
  for (const s of [...screens].sort((a, b) => a.theme.localeCompare(b.theme))) {
    if (!s.anchors) continue;
    const n = String(s.index + 1);
    const at = (now[s.feature] ??= {});
    const was = at[n];
    if (!was) at[n] = s.anchors;
    else if (JSON.stringify(was) !== JSON.stringify(s.anchors))
      problems.push(`${s.feature} #${n}: the themes place its anchors differently`);
  }
  // Each anchor in one place on every screen of its feature where it shows.
  for (const [feature, byScreen] of Object.entries(now)) {
    /** @type {Map<string, { n: string, box: Box }>} */
    const first = new Map();
    for (const [n, anchors] of Object.entries(byScreen))
      for (const [name, box] of Object.entries(anchors)) {
        if (!box) continue;
        const f = first.get(name);
        if (!f) first.set(name, { n, box });
        else if (f.box.join() !== box.join())
          problems.push(
            `${feature}: anchor ${name} moves between screens (#${f.n} ${showBox(f.box)}, #${n} ${showBox(box)})`
          );
      }
  }
  const committed = /** @type {Geometry} */ (
    existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  );
  /** @type {Geometry} */
  const next = complete ? now : { ...committed };
  if (!complete)
    for (const [f, byScreen] of Object.entries(now)) next[f] = { ...committed[f], ...byScreen };
  if (!update) {
    for (const [feature, byScreen] of Object.entries(now))
      for (const [n, anchors] of Object.entries(byScreen))
        for (const [name, box] of Object.entries(anchors)) {
          const was = committed[feature]?.[n]?.[name];
          if (was === undefined) problems.push(`${feature} #${n}: anchor ${name} is not locked`);
          else if (JSON.stringify(was) !== JSON.stringify(box))
            problems.push(
              `${feature} #${n}: anchor ${name} moved (${showBox(was)} → ${showBox(box)})`
            );
        }
    // A removed anchor, screen or feature: only a full run can tell.
    if (complete)
      for (const f of new Set([...Object.keys(committed), ...Object.keys(now)]))
        if (
          JSON.stringify(committed[f]) !== JSON.stringify(now[f]) &&
          !problems.some((p) => p.startsWith(`${f} `) || p.startsWith(`${f}:`))
        )
          problems.push(
            `${f}: the locked geometry has an anchor, screen or feature this run does not`
          );
  }
  const written = update && JSON.stringify(next) !== JSON.stringify(committed);
  if (written) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { problems, written, geometry: now };
}

/**
 * Each rendered screen's accessibility and layout findings, one line per screen that has any.
 * @template {{ rendered: boolean, axe: { id: string, count: number }[], layout: { rule: string, text: string }[] }} S
 * @param {S[]} screens
 * @param {(s: S) => string} idOf
 */
export const screenFindings = (screens, idOf) =>
  screens
    .filter((x) => x.rendered && (x.axe.length || x.layout.length))
    .map(
      (x) =>
        `${idOf(x)}: ${[
          ...x.axe.map((v) => `axe ${v.id} (${v.count})`),
          ...x.layout.map((l) => `layout ${l.rule}: ${l.text}`),
        ].join('; ')}`
    );
