/**
 * lib/text/say.mjs — one wording of a check row's text labels (`textDiff`, from the engine,
 * crates/pxsig-core/src/text.rs) for every output that shows them: MCP (`pxsig_list`'s brief,
 * `pxsig_entry`'s `textLines`), the CLI (`pxsig entry`'s Text block, `pxsig list`'s Why column) and
 * the rejection packet (`textLines`, and `textBoxes` for its crops). summary.md's suffix is the
 * engine's (crates/pxsig-cli/src/report_text.rs), in the same words (`TEXT_SUFFIX`; a test keeps
 * the two in step).
 *
 * Labels only: nothing reads these back to decide anything. A verdict, an exit code, a SARIF
 * result or a JUnit outcome is the same with or without them. Copy is neutral: no "you", no
 * questions. docs/spec.md section 7, docs/configuration.md#text.
 */

/** @import { TextBox, TextBrief, TextChange, TextDiff, TextKind } from '../../types/text.js' */

/** What each entry kind is called, as a label (the dashboard's badge, `pxsig entry`). */
export const TEXT_KIND_LABEL = Object.freeze({
  copy: 'Copy',
  'copy-reflow': 'Copy, reflow',
  moved: 'Text moved',
  restyled: 'Text restyled',
  pixel: 'Pixel change',
});

/** The short form after a row's reasons (`· text: copy, reflow`); none for `pixel`. */
export const TEXT_SUFFIX = Object.freeze({
  copy: 'copy',
  'copy-reflow': 'copy, reflow',
  moved: 'moved',
  restyled: 'restyled',
});

/** Said wherever the labels are shown to a person deciding. */
export const TEXT_LABELS_ONLY = 'Labels only. The gate and the decision are unchanged.';

/** The values `pxsig_list`'s `text` filter (and `pxsig list --text`) takes. */
export const TEXT_FILTERS = /** @type {const} */ ([
  'copy',
  'copy-reflow',
  'moved',
  'restyled',
  'any',
]);

/** The states that compare nothing, one sentence each. */
const STATE = {
  'env-differs':
    "Text not compared: text is compared only within one environment, and this render's environment is not its baseline's. Labels appear once a render from this environment is approved as the baseline.",
  'no-baseline': 'No text record in the baseline. One is recorded at its next approval.',
};

/** Font facts (`TextStyle` keys) in words. */
const FACT = /** @type {Record<string, string>} */ ({
  family: 'font family',
  size: 'font size',
  weight: 'font weight',
  style: 'font style',
  lineHeight: 'line height',
  letterSpacing: 'letter spacing',
  wordSpacing: 'word spacing',
  transform: 'text transform',
  decoration: 'decoration',
  color: 'colour',
  features: 'font features',
  variation: 'font variation',
  loaded: 'font loading',
});

/** The longest string a sentence quotes in full. */
const MAX_QUOTE = 80;

/**
 * `n thing` / `n things`, with a thousands separator.
 * @param {number} n
 * @param {string} one
 * @param {string} [many]
 */
const count = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * Words joined as a list: "a", "a and b", "a, b and c".
 * @param {string[]} w
 */
const and = (w) => (w.length < 2 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} and ${w.at(-1)}`);

/**
 * A px value as the record rounds it (0.01), without trailing zeros.
 * @param {number} v
 */
const px = (v) => `${Number(Math.abs(v).toFixed(2))}px`;

/**
 * A string quoted, whitespace made visible where it matters: line breaks and tabs always (they
 * would break the line), spaces at either end (or every space, for a change in whitespace only)
 * as `␠`. Long strings are cut with `…`.
 * @param {string} s
 * @param {boolean} [spaces] show every space
 */
function quote(s, spaces = false) {
  const cut = s.length > MAX_QUOTE ? `${s.slice(0, MAX_QUOTE - 1)}…` : s;
  let v = cut.replace(/\n/g, '↵').replace(/\t/g, '⇥');
  if (spaces) v = v.replace(/ /g, '␠');
  else
    v = v.replace(/^ +/, (m) => '␠'.repeat(m.length)).replace(/ +$/, (m) => '␠'.repeat(m.length));
  return `"${v}"`;
}

/**
 * A whitespace-only copy change in words: "a space added", "2 spaces removed", "whitespace only".
 * @param {string} was
 * @param {string} now
 */
function spaceChange(was, now) {
  const ws = (/** @type {string} */ s) => (s.match(/\s/g) ?? []).length;
  const d = ws(now) - ws(was);
  if (d === 1) return 'whitespace only: a space added';
  if (d === -1) return 'whitespace only: a space removed';
  if (d) return `whitespace only: ${Math.abs(d)} spaces ${d > 0 ? 'added' : 'removed'}`;
  return 'whitespace only';
}

/**
 * A move in words ("4.2px right", "3px down", "1px left and 2px up"), or null for none.
 * @param {TextChange} c
 */
function moveOf(c) {
  const dx = c.dx ?? 0;
  const dy = c.dy ?? 0;
  const parts = [];
  if (Math.abs(dx) >= 0.005) parts.push(`${px(dx)} ${dx > 0 ? 'right' : 'left'}`);
  if (Math.abs(dy) >= 0.005) parts.push(`${px(dy)} ${dy > 0 ? 'down' : 'up'}`);
  return parts.length ? parts.join(' and ') : null;
}

/**
 * The copy change that pushed `c`, in words.
 * @param {TextChange} c
 * @param {TextChange[]} all
 */
function pushedBy(c, all) {
  const k = c.pushedBy === undefined ? undefined : all[c.pushedBy];
  if (k?.kind === 'copy' && k.was !== undefined && k.now !== undefined)
    return `pushed by the copy change ${quote(k.was, k.whitespace)} → ${quote(k.now, k.whitespace)}`;
  return 'pushed by a copy change';
}

/**
 * One change as one sentence.
 * @param {TextChange} c
 * @param {TextChange[]} all the row's listed changes (`pushedBy` indexes them)
 */
export function sayChange(c, all = []) {
  const move = moveOf(c);
  const facts = and((c.facts ?? []).map((f) => FACT[f] ?? f));
  const same = c.same ? `, and ${count(c.same, 'more run')} the same way` : '';
  const push = c.pushed ? `, ${pushedBy(c, all)}` : '';
  const s = quote(c.s ?? '');
  switch (c.kind) {
    case 'copy': {
      const ws = c.whitespace === true;
      const was = quote(c.was ?? '', ws);
      const now = quote(c.now ?? '', ws);
      return [
        `Copy: ${was} → ${now}`,
        ws ? ` (${spaceChange(c.was ?? '', c.now ?? '')})` : '',
        facts ? `, ${facts} changed too` : '',
        move ? `, moved ${move}` : '',
        push,
      ].join('');
    }
    case 'moved':
      return `${s} moved${move ? ` ${move}` : ''}${same}${push}`;
    case 'rewrapped':
      return `${s} rewrapped${move ? `, moved ${move}` : ''}${push}`;
    case 'restyled':
      return `${s}: ${facts || 'style'} changed${move ? `, moved ${move}` : ''}${push}`;
    case 'added':
      return `Added: ${s}`;
    case 'removed':
      return `Removed: ${s}`;
    default:
      return `${s} changed`;
  }
}

/**
 * The changed pixels outside text, in one sentence; null when the row has no pixel count (its
 * text did not differ and it got no pixel diff).
 * @param {Extract<TextDiff, { state: 'compared' }>} t
 */
function pixelsOf(t) {
  if (t.outsidePx === undefined) return null;
  const el = t.elementPx ?? 0;
  const rest = t.outsidePx - el;
  const boxes = `in boxes a copy change moved or resized`;
  if (rest > 0)
    return `${count(rest, 'changed pixel')} outside text${el ? `, besides ${el.toLocaleString('en-US')} ${boxes}` : ''}.`;
  if (el)
    return `No pixels changed outside text apart from ${count(el, 'changed pixel')} ${boxes}.`;
  return 'No pixels changed outside text.';
}

/**
 * What a compared row with no text change says.
 * @param {Extract<TextDiff, { state: 'compared' }>} t
 */
const nothing = (t) =>
  t.kind === 'pixel' || (t.outsidePx ?? 0) > 0
    ? 'No text changed. The change is outside text.'
    : 'No text changed.';

/**
 * The label of an entry kind ("Copy, reflow"); null for none.
 * @param {TextKind | null | undefined} kind
 */
export const textKindLabel = (kind) => (kind ? TEXT_KIND_LABEL[kind] : null);

/**
 * The text after a row's reasons: `text: copy, reflow`; empty for `pixel` and for none.
 * @param {TextKind | null | undefined} kind the row's `textDiff.kind` (or the brief's `textKind`)
 */
export const textSuffix = (kind) => (kind && kind !== 'pixel' ? `text: ${TEXT_SUFFIX[kind]}` : '');

/**
 * A row's text labels in one line: the kind, the counts and the pixels outside text; or why
 * nothing was compared. Null without a `textDiff`.
 * @param {TextDiff | undefined} t
 * @returns {string | null}
 */
export function textSummary(t) {
  if (!t) return null;
  if (t.state === 'error') return `Text record not read: ${t.error}`;
  if (t.state !== 'compared') return STATE[t.state] ?? null;
  if (!t.changeCount) return nothing(t);
  const c = t.counts;
  const parts = [
    c.copy && count(c.copy, 'copy change'),
    c.moved && `${count(c.moved, 'run')} moved`,
    c.rewrapped && `${count(c.rewrapped, 'run')} rewrapped`,
    c.restyled && `${count(c.restyled, 'run')} restyled`,
    c.added && `${count(c.added, 'run')} added`,
    c.removed && `${count(c.removed, 'run')} removed`,
  ].filter(Boolean);
  const label = textKindLabel(t.kind) ?? 'Text';
  const pixels = pixelsOf(t);
  return `${label}: ${parts.join(', ') || 'text changed'}.${pixels ? ` ${pixels}` : ''}`;
}

/**
 * A row's text labels as sentences, one per listed change (the first 20, largest first), then
 * how many more there are, the pixels outside text, and a record past the capture's cap. A row
 * that compared nothing gives its one sentence; none without a `textDiff`.
 * @param {TextDiff | undefined} t
 * @returns {string[]}
 */
export function textLines(t) {
  if (!t) return [];
  if (t.state !== 'compared') return [/** @type {string} */ (textSummary(t))];
  if (!t.changeCount) return [nothing(t)];
  const lines = t.changes.map((c) => sayChange(c, t.changes));
  const more = t.changeCount - t.changes.length;
  if (more > 0) lines.push(`And ${count(more, 'more change')}.`);
  const pixels = pixelsOf(t);
  if (pixels) lines.push(pixels);
  if (t.truncated) lines.push('Text past the capture cap (5,000 runs) is not compared.');
  return lines;
}

/**
 * The boxes of a row's listed changes, for crops: each change's first line box where the render
 * draws it (the baseline's, for a removed run), and, for a run that moved, where the baseline drew
 * it. Rounded to 0.01 px, each box once; none when nothing was compared or nothing changed.
 * @param {TextDiff | undefined} t
 * @returns {TextBox[]}
 */
export function textBoxes(t) {
  if (t?.state !== 'compared') return [];
  const r = (/** @type {number} */ v) => Number(v.toFixed(2));
  /** @type {Map<string, TextBox>} */
  const out = new Map();
  const add = (/** @type {TextBox} */ b) => {
    const box = /** @type {TextBox} */ (b.map(r));
    out.set(box.join(','), box);
  };
  for (const c of t.changes) {
    if (!c.box) continue;
    add(c.box);
    const [x, y, w, h] = c.box;
    if (moveOf(c)) add([x - (c.dx ?? 0), y - (c.dy ?? 0), w, h]);
  }
  return [...out.values()];
}

/**
 * What `pxsig_list`'s brief adds for a row's text: the kind (null when nothing in text differs)
 * and its summary, or the state that compared nothing and why. Empty without a `textDiff`; a row
 * whose text is the same gets `textKind: null` and no summary.
 * @param {TextDiff | undefined} t
 * @returns {TextBrief}
 */
export function textBrief(t) {
  if (!t) return {};
  if (t.state !== 'compared')
    return { textState: t.state, textSummary: /** @type {string} */ (textSummary(t)) };
  if (!t.kind && !t.changeCount) return { textKind: null };
  return { textKind: t.kind, textSummary: /** @type {string} */ (textSummary(t)) };
}

/**
 * Whether a row's text labels match `pxsig_list`'s `text` filter: an entry kind, or `any` for a
 * compared row with any text change.
 * @param {TextDiff | undefined} t
 * @param {string} filter
 */
export function textMatches(t, filter) {
  if (t?.state !== 'compared') return false;
  if (filter === 'any') return t.changeCount > 0;
  return t.kind === filter;
}
