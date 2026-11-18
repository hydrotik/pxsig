/**
 * The top bar's fit (top-bar-fit.ts) in the page: measures the bar the adapter drew, decides what
 * shows, and writes it on the bar's root as `data-collapse` (the shed details and a capped label),
 * `data-compact` (the compact controls) and `--pxsig-scope-max` (the label's width), which
 * styles/top-bar.css.ts reads. It re-measures when the bar, its list, its end group or the brand
 * resize, when the list's items change (an adapter moving links into More), when fonts load and when
 * the links' labels or counts change.
 *
 * What it reads, for any adapter: the bar is the brand's `.pxsig-ui-TopNav` ancestor (TopNav puts
 * `className` on its root), the end group is NavEnd's root, the list is the element holding the
 * section links beside it, and More is the list's `aria-haspopup="menu"` control. The dashboard's
 * own elements carry `data-top-bar`.
 */
import React from 'react';
import {
  type BarMeasure,
  type BarState,
  COMPACT,
  DETAILS,
  FULL,
  decide,
  linksFit,
  same,
} from './top-bar-fit';

const px = (v: string) => parseFloat(v) || 0;
const box = (el: Element | null | undefined) => (el ? el.getBoundingClientRect() : null);
const width = (el: Element | null | undefined) => box(el)?.width ?? 0;
const shown = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};

/** The project picker's width in rem, and its narrowest. */
export const PICKER = { full: 14, min: 5 };

export interface BarParts {
  bar: HTMLElement;
  list: HTMLElement;
  end: HTMLElement;
}

/** The bar, its list and its end group, from the brand heading and NavEnd's class. */
export function barParts(brand: HTMLElement | null, endClass: string): BarParts | null {
  const bar = (brand?.closest('.pxsig-ui-TopNav') ?? brand?.closest('nav')) as HTMLElement | null;
  const end = bar?.querySelector<HTMLElement>(`.${endClass}`) ?? null;
  const link = bar?.querySelector('a[href^="#"]');
  if (!bar || !end || !link || !end.parentElement) return null;
  let list = link as HTMLElement;
  while (list.parentElement && list.parentElement !== end.parentElement) list = list.parentElement;
  return list.parentElement ? { bar, list, end } : null;
}

/** Everything `decide` needs, measured now. `kept`: the hrefs of the links that never move. */
export function measureBar(
  { bar, list, end }: BarParts,
  { total, kept }: { total: number; kept: string[] }
): BarMeasure {
  const q = (name: string) => bar.querySelector<HTMLElement>(`[data-top-bar="${name}"]`);
  const ls = getComputedStyle(list);
  const holder = end.parentElement as HTMLElement;
  const hs = getComputedStyle(holder);
  const inner =
    holder.getBoundingClientRect().right - px(hs.borderRightWidth) - px(hs.paddingRight);
  const over = Math.max(0, (box(end)?.right ?? 0) - inner);
  const room = list.clientWidth - px(ls.paddingLeft) - px(ls.paddingRight) - over;
  const gapEnd = px(getComputedStyle(end).columnGap);
  const gapList = px(ls.columnGap);
  const details = DETAILS.map((d) => (q(d) ? width(q(d)) + gapEnd : 0));
  const rem = px(getComputedStyle(document.documentElement).fontSize) || 16;
  // The end group's items in flow now, for its gaps.
  const inFlow = [...end.children].filter(
    (c) => getComputedStyle(c).position !== 'absolute' && width(c) > 0
  ).length;
  const gaps = Math.max(0, inFlow - 1);
  const compact = COMPACT.map((c): [number, number] =>
    c === 'picker'
      ? q('picker')
        ? [PICKER.full * rem, PICKER.min * rem]
        : [0, 0]
      : c === 'tight'
        ? [gaps * width(q('gap')), gaps * width(q('gap-tight'))]
        : [width(q(`${c}-full`)), width(q(`${c}-compact`))]
  );
  const scopeEl = q('scope');
  const natural = scopeEl ? scopeEl.scrollWidth : 0;
  const scope = {
    natural,
    cap: Math.min(natural, width(q('scope-cap'))),
    min: Math.min(natural, width(q('scope-min'))),
  };
  // The list's own items: section links, the More trigger, anything else the adapter puts there.
  const items = [...list.children].filter(shown);
  const inMenu = (a: Element) => a.closest('[role="menu"]');
  const linksShown = [...list.querySelectorAll('a[href^="#"]')].filter(
    (a) => !inMenu(a) && shown(a)
  );
  const trigger = [...list.querySelectorAll('[aria-haspopup="menu"]')].find(shown);
  const span = (els: Element[]) =>
    els.length
      ? Math.max(...els.map((e) => box(e)!.right)) - Math.min(...els.map((e) => box(e)!.left))
      : 0;
  const links = !trigger && linksShown.length === total ? span(items) : null;
  const pinned = items.filter(
    (it) => it.contains(trigger ?? null) || kept.some((h) => it.querySelector(`a[href="${h}"]`))
  );
  const more = trigger
    ? pinned.reduce((sum, it) => sum + width(it), 0) + gapList * Math.max(0, pinned.length - 1)
    : null;
  return {
    width: width(bar),
    room,
    details,
    compact,
    scope,
    links,
    more,
    tol: gapList + total * 0.5 + 1,
  };
}

/** Write a state on the bar's root. */
export function applyBar(bar: HTMLElement, s: BarState) {
  const shed = DETAILS.slice(0, s.shed) as string[];
  if (s.scope !== 'full') shed.push('scope');
  bar.dataset.collapse = shed.join(' ');
  bar.dataset.compact = COMPACT.slice(0, s.compact).join(' ');
  bar.style.setProperty('--pxsig-bar-spare', `${s.spare}px`);
  bar.style.setProperty(
    '--pxsig-picker',
    s.compact > 0 && s.picker ? `${s.picker}px` : `${PICKER.full}rem`
  );
  bar.style.setProperty(
    '--pxsig-scope-max',
    typeof s.scope === 'number' ? `${s.scope}px` : s.scope === 'cap' ? '24ch' : 'none'
  );
}

/**
 * Fits the bar whose brand is `brand`; returns the state, for what the bar says rather than draws
 * (the last check in the connection's hint while it is hidden). `sig` changes with the links'
 * labels and counts.
 */
export function useTopBarFit(
  brand: React.RefObject<HTMLElement | null>,
  { endClass, total, kept, sig }: { endClass: string; total: number; kept: string[]; sig: string }
): BarState {
  const [state, setState] = React.useState<BarState>(FULL);
  // The last links and More widths seen, and the least the links need (raised when the adapter
  // keeps More where the widths said the links fit): kept across renders, the floor per `sig`.
  const known = React.useRef({
    links: null as number | null,
    more: null as number | null,
    floor: 0,
    doubt: 0,
  });
  const keptKey = kept.join(' ');
  React.useLayoutEffect(() => {
    const parts = barParts(brand.current, endClass);
    if (!parts) return;
    known.current.floor = 0;
    let now: BarState = FULL;
    let frame = 0;
    const run = () => {
      frame = 0;
      const m = measureBar(parts, { total, kept: keptKey ? keptKey.split(' ') : [] });
      const k = known.current;
      if (m.links != null) k.links = Math.max(m.links, k.floor);
      if (m.more != null) k.more = m.more;
      const next = decide(m, now, k);
      // The widths say every link fits, yet the adapter shows More: after three looks in a row,
      // believe the adapter and raise what the links need above this room.
      if (same(next, now) && m.more != null && linksFit(m, now, next, k.links)) {
        if (++k.doubt >= 3) {
          k.floor = m.room + 1 - m.tol;
          k.links = Math.max(k.links ?? 0, k.floor);
          k.doubt = 0;
        }
        if (!frame) frame = requestAnimationFrame(run);
      } else k.doubt = 0;
      if (same(next, now)) return;
      now = next;
      applyBar(parts.bar, next);
      setState(next);
    };
    applyBar(parts.bar, now);
    run();
    const later = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const sizes = new ResizeObserver(later);
    for (const el of [parts.bar, parts.list, parts.end, brand.current]) if (el) sizes.observe(el);
    const items = new MutationObserver(later);
    items.observe(parts.list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'style', 'class'],
    });
    document.fonts?.addEventListener?.('loadingdone', later);
    return () => {
      sizes.disconnect();
      items.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', later);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [brand, endClass, total, keptKey, sig]);
  return state;
}
