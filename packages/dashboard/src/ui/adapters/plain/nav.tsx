/**
 * The plain adapter's top bar: one line at every width (region rule R1; docs/ui/build-adapter.md,
 * "Top bar"). The section links that do not fit move into a More menu, the last link first; a
 * `keep` link stays in the bar. The More button sits right after the last link shown, before the
 * kept one, and the list never gets narrower than the two of them. Every link is measured at its
 * natural width whenever the list resizes, fonts load or the links change. The menu follows the menu
 * button pattern: the arrow keys (wrapping), Home and End move through it, Escape closes it and
 * returns focus to the button, Tab closes it and goes on from the button. It is drawn in the bar's
 * <nav> (a landmark, so axe's `region` holds) through a portal, fixed under the button, so the
 * list's clipping does not cut it and the bar's line holds.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import type * as C from '../../contract';
import copy from './copy.json';

export const TopNav = ({ label, brand, className, children }: C.TopNavProps) => (
  <nav aria-label={label} className={['plain-nav', className].filter(Boolean).join(' ')}>
    {brand}
    {children}
  </nav>
);

/** A link's text for its accessible name: the dashboard passes the label as text. */
const textOf = (node: React.ReactNode): string =>
  React.Children.toArray(node)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
    .join('');

/** A section link, in the bar or (`item`) as an item of the More menu. */
const SectionLink = ({
  href,
  active,
  count,
  countTone,
  countLabel,
  children,
  item,
  onClick,
}: C.NavLinkProps & { item?: boolean; onClick?: () => void }) => (
  <a
    href={href}
    role={item ? 'menuitem' : undefined}
    tabIndex={item ? -1 : undefined}
    aria-current={active ? 'page' : undefined}
    aria-label={count ? `${textOf(children)}, ${countLabel ?? count}` : undefined}
    onClick={onClick}
  >
    {children}
    {count ? (
      <span className="plain-badge" data-tone={countTone}>
        {' '}
        {count > 99 ? '99+' : count}
      </span>
    ) : null}
  </a>
);
export const NavLink = (p: C.NavLinkProps) => <SectionLink {...p} />;

/**
 * Which links move into the menu: none when every link fits, else the links that are not kept, the
 * last first, until the rest and the More button fit.
 */
function overflowing(widths: number[], kept: boolean[], more: number, room: number, gap: number) {
  const width = (shown: number[], extra: number) =>
    shown.reduce((sum, i) => sum + widths[i], extra) + gap * Math.max(0, shown.length - 1);
  let shown = widths.map((_, i) => i);
  if (width(shown, 0) <= room + 0.5) return [];
  const moved: number[] = [];
  for (let i = widths.length - 1; i >= 0 && width(shown, more + gap) > room + 0.5; i--) {
    if (kept[i]) continue;
    moved.unshift(i);
    shown = shown.filter((j) => j !== i);
  }
  return moved;
}

export function NavList({ moreLabel = copy.more, children }: C.NavListProps) {
  const links = React.Children.toArray(children).filter(
    React.isValidElement
  ) as React.ReactElement<C.NavLinkProps>[];
  const list = React.useRef<HTMLUListElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLUListElement>(null);
  const [moved, setMoved] = React.useState<number[]>([]);
  const [open, setOpen] = React.useState(false);
  const menuId = React.useId();
  // Where the menu is drawn: the bar's <nav>, once the list is in it.
  const [host, setHost] = React.useState<Element | null>(null);
  React.useLayoutEffect(() => setHost(list.current?.closest('nav') ?? document.body), []);

  // Measure every item at its natural width (each shown for the measure, before the paint), then
  // move the ones that do not fit. The list takes the bar's free width, so its own size is the room.
  const fit = React.useCallback(() => {
    const ul = list.current;
    if (!ul) return;
    const all = [...ul.children] as HTMLElement[];
    const hidden = all.map((li) => li.hidden);
    for (const li of all) li.hidden = false;
    const width = (li?: HTMLElement) => li?.getBoundingClientRect().width ?? 0;
    const items = all.filter((li) => !li.classList.contains('plain-more'));
    const widths = items.map(width);
    const more = width(all.find((li) => li.classList.contains('plain-more')));
    all.forEach((li, i) => (li.hidden = hidden[i]));
    const kept = items.map((li) => li.dataset.keep !== undefined);
    const gap = parseFloat(getComputedStyle(ul).columnGap) || 0;
    const next = overflowing(widths, kept, more, ul.clientWidth, gap);
    // Never narrower than what stays: the kept links, and More while it holds any.
    const stay = [...widths.filter((_, i) => kept[i]), ...(next.length ? [more] : [])];
    const least = stay.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, stay.length - 1);
    ul.style.minInlineSize = `${Math.ceil(least)}px`;
    setMoved((was) => (was.join() === next.join() ? was : next));
    if (!next.length) setOpen(false);
  }, []);
  React.useLayoutEffect(fit);
  React.useLayoutEffect(() => {
    const ul = list.current;
    if (!ul || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => fit());
    watch.observe(ul);
    // Web fonts change every width: measure again whenever some have loaded.
    void document.fonts?.ready.then(() => fit());
    document.fonts?.addEventListener?.('loadingdone', fit);
    return () => {
      watch.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', fit);
    };
  }, [fit]);
  // The open menu sits under the button, its end edge at the button's, inside the window.
  const place = React.useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    const m = menu.current;
    if (!b || !m) return;
    m.style.insetBlockStart = `${b.bottom + 8}px`;
    m.style.insetInlineStart = `${Math.max(8, Math.min(b.right, innerWidth - 8) - m.offsetWidth)}px`;
  }, []);
  React.useLayoutEffect(() => {
    if (!open) return;
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [open, place]);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const show = (at: 'first' | 'last') => {
    setOpen(true);
    requestAnimationFrame(() => {
      const all = items();
      all[at === 'first' ? 0 : all.length - 1]?.focus();
    });
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  // A pointer outside the menu closes it.
  React.useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const at = e.target as Node;
      if (!menu.current?.contains(at) && !button.current?.contains(at)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const to = {
      ArrowDown: (at + 1) % all.length,
      ArrowUp: (at - 1 + all.length) % all.length,
      Home: 0,
      End: all.length - 1,
    }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      all[to]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      // Tab goes on from the button, as if the menu were not there.
      button.current?.focus();
      setOpen(false);
    }
  };
  const onButtonKey = (e: React.KeyboardEvent) => {
    // Escape on the button (the menu open, its first item not focused yet) closes it too.
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      return close(true);
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    show(e.key === 'ArrowDown' ? 'first' : 'last');
  };

  // The menu button sits where its links were: after the last one it holds, before a kept link.
  const at = moved.length ? moved[moved.length - 1] : links.length - 1;
  const more = (
    <li key="plain-more" className="plain-more" hidden={!moved.length}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-label={moreLabel}
        aria-expanded={open}
        aria-controls={menuId}
        data-current={moved.some((i) => links[i].props.active) || undefined}
        onClick={() => (open ? close(false) : show('first'))}
        onKeyDown={onButtonKey}
      >
        {copy.more}
        <span aria-hidden="true"> ▾</span>
      </button>
      {host &&
        createPortal(
          <ul
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={moreLabel}
            className="plain-menu"
            hidden={!open}
            onKeyDown={onMenuKey}
          >
            {moved.map((i) => (
              <li key={links[i].key ?? i} role="none">
                <SectionLink {...links[i].props} item onClick={() => close(false)} />
              </li>
            ))}
          </ul>,
          host
        )}
    </li>
  );
  return (
    <ul ref={list}>
      {links.flatMap((l, i) => [
        <li key={l.key ?? i} data-keep={l.props.keep || undefined} hidden={moved.includes(i)}>
          {l}
        </li>,
        ...(i === at ? [more] : []),
      ])}
    </ul>
  );
}
