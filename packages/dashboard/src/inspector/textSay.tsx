/**
 * A row's text labels (`textDiff`) in words, from en.json: the header badge's label, the Text
 * section's summary and one sentence per change. The same sentences as packages/pxsig's
 * lib/text/say.mjs (MCP, the CLI, the rejection packet); test/flows-text.test.mjs keeps the two in
 * step. Labels only: nothing reads them back to decide anything.
 */
import type { ReactNode } from 'react';
import { has, t, tx, type CopyKey } from '../copy';
import type { TextChange, TextCompared, TextDiff, TextKind } from '../data/text-types';

/** Each entry kind's label key; none for `pixel` in the header (it is a pixel change). */
const KIND: Record<TextKind, CopyKey> = {
  copy: 'inspector.text.kind.copy',
  'copy-reflow': 'inspector.text.kind.copyReflow',
  moved: 'inspector.text.kind.moved',
  restyled: 'inspector.text.kind.restyled',
  pixel: 'inspector.text.kind.pixel',
};

/** The header badge's label: Copy, Copy, reflow, Text moved or Text restyled; null otherwise. */
export function textBadge(d: TextDiff | undefined): string | null {
  if (d?.state !== 'compared' || !d.kind || d.kind === 'pixel') return null;
  return t(KIND[d.kind]);
}

/** The longest string a sentence quotes in full. */
const MAX_QUOTE = 80;

/** A string quoted, line breaks and tabs shown, spaces at either end (or all, `spaces`) as `␠`. */
export function quote(s: string, spaces = false): string {
  const cut = s.length > MAX_QUOTE ? `${s.slice(0, MAX_QUOTE - 1)}…` : s;
  let v = cut.replace(/\n/g, '↵').replace(/\t/g, '⇥');
  if (spaces) v = v.replace(/ /g, '␠');
  else
    v = v.replace(/^ +/, (m) => '␠'.repeat(m.length)).replace(/ +$/, (m) => '␠'.repeat(m.length));
  return t('inspector.text.quote', { s: v });
}

/** Words joined as a list: "a", "a and b", "a, b and c". */
function and(w: string[]): string {
  if (w.length < 2) return w[0] ?? '';
  return t('inspector.text.list.two', {
    a: w.slice(0, -1).join(t('inspector.text.list.sep')),
    b: w.at(-1),
  });
}

const px = (v: number) =>
  t('inspector.text.move.px', { v: String(Number(Math.abs(v).toFixed(2))) });

/** A move in words ("4.2px right", "1px left and 2px up"), or null for none. */
export function moveOf(c: TextChange): string | null {
  const dx = c.dx ?? 0;
  const dy = c.dy ?? 0;
  const x =
    Math.abs(dx) >= 0.005
      ? t(`inspector.text.move.${dx > 0 ? 'right' : 'left'}`, { px: px(dx) })
      : null;
  const y =
    Math.abs(dy) >= 0.005
      ? t(`inspector.text.move.${dy > 0 ? 'down' : 'up'}`, { px: px(dy) })
      : null;
  return x && y ? t('inspector.text.move.both', { x, y }) : (x ?? y);
}

/** A whitespace-only copy change in words. */
function spaceChange(was: string, now: string): string {
  const ws = (s: string) => (s.match(/\s/g) ?? []).length;
  const d = ws(now) - ws(was);
  if (!d) return t('inspector.text.whitespace.same');
  return t(`inspector.text.whitespace.${d > 0 ? 'added' : 'removed'}`, { count: Math.abs(d) });
}

/** The font facts that differ, in words. */
const facts = (c: TextChange) =>
  and(
    (c.facts ?? []).map((f) =>
      has(`inspector.text.facts.${f}`) ? t(`inspector.text.facts.${f}` as CopyKey) : f
    )
  );

/** The quoted string of a sentence, in mono. */
type Mono = (s: string) => ReactNode;

/** The copy change that pushed `c`. */
function pushedBy(c: TextChange, all: TextChange[], m: Mono): ReactNode {
  const k = c.pushedBy === undefined ? undefined : all[c.pushedBy];
  if (k?.kind === 'copy' && k.was !== undefined && k.now !== undefined)
    return tx('inspector.text.change.pushedByCopy', {
      was: m(quote(k.was, k.whitespace)),
      now: m(quote(k.now, k.whitespace)),
    });
  return t('inspector.text.change.pushedByA');
}

/** One change as one sentence, its quoted strings through `m`. */
export function sayChange(c: TextChange, all: TextChange[], m: Mono): ReactNode {
  const move = moveOf(c);
  const f = facts(c);
  const same = c.same ? t('inspector.text.change.same', { count: c.same }) : '';
  const push = c.pushed ? pushedBy(c, all, m) : '';
  const s = m(quote(c.s ?? ''));
  const moved = move ? t('inspector.text.change.movedBy', { move }) : '';
  switch (c.kind) {
    case 'copy': {
      const ws = c.whitespace === true;
      return (
        <>
          {tx('inspector.text.change.copy', {
            was: m(quote(c.was ?? '', ws)),
            now: m(quote(c.now ?? '', ws)),
          })}
          {ws
            ? t('inspector.text.change.aside', { what: spaceChange(c.was ?? '', c.now ?? '') })
            : ''}
          {f ? t('inspector.text.change.factsToo', { facts: f }) : ''}
          {moved}
          {push}
        </>
      );
    }
    case 'moved':
      return (
        <>
          {move
            ? tx('inspector.text.change.movedTo', { s, move })
            : tx('inspector.text.change.moved', { s })}
          {same}
          {push}
        </>
      );
    case 'rewrapped':
      return (
        <>
          {tx('inspector.text.change.rewrapped', { s })}
          {moved}
          {push}
        </>
      );
    case 'restyled':
      return (
        <>
          {tx('inspector.text.change.restyled', {
            s,
            facts: f || t('inspector.text.change.style'),
          })}
          {moved}
          {push}
        </>
      );
    case 'added':
      return tx('inspector.text.change.added', { s });
    case 'removed':
      return tx('inspector.text.change.removed', { s });
    default:
      return tx('inspector.text.change.changed', { s });
  }
}

/** The changed pixels outside text, in one sentence; null without a pixel count. */
function pixelsOf(d: TextCompared): string | null {
  if (d.outsidePx === undefined) return null;
  const el = d.elementPx ?? 0;
  const rest = d.outsidePx - el;
  if (rest > 0)
    return `${t('inspector.text.pixels.outside', { count: rest })}${el ? t('inspector.text.pixels.besides', { count: el }) : ''}.`;
  if (el) return t('inspector.text.pixels.elementsOnly', { count: el });
  return t('inspector.text.pixels.none');
}

/** What a compared row with no text change says. */
const nothing = (d: TextCompared) =>
  t(
    d.kind === 'pixel' || (d.outsidePx ?? 0) > 0
      ? 'inspector.text.noneChanged'
      : 'inspector.text.noneChangedPlain'
  );

const COUNTS = ['copy', 'moved', 'rewrapped', 'restyled', 'added', 'removed'] as const;

/** A row's text labels in one line: the kind, the counts and the pixels outside text; or why nothing was compared. */
export function textSummary(d: TextDiff | undefined): string | null {
  if (!d) return null;
  if (d.state === 'error') return t('inspector.text.error', { error: d.error });
  if (d.state !== 'compared')
    return t(d.state === 'no-baseline' ? 'inspector.text.noBaseline' : 'inspector.text.envDiffers');
  if (!d.changeCount) return nothing(d);
  const parts = COUNTS.filter((k) => d.counts[k]).map((k) =>
    t(`inspector.text.count.${k}`, { count: d.counts[k] })
  );
  const label = d.kind ? t(KIND[d.kind]) : t('inspector.text.summaryLabel');
  const line = t('inspector.text.summary', {
    label,
    parts: parts.join(t('inspector.text.list.sep')) || t('inspector.text.changed'),
  });
  const pixels = pixelsOf(d);
  return pixels ? `${line} ${pixels}` : line;
}
