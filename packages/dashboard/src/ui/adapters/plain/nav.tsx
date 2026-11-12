/**
 * The plain adapter's top bar: one line at every width (region rule R1). The section links that do
 * not fit move into a More menu at the end of the list, the last link first; a `keep` link stays in
 * the bar. The menu follows the menu button pattern: the arrow keys, Home and End move through it,
 * Escape closes it and returns focus to the button.
 */
import React from 'react';
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

export function NavList({ children }: C.NavListProps) {
  const links = React.Children.toArray(children).filter(
    React.isValidElement
  ) as React.ReactElement<C.NavLinkProps>[];
  const list = React.useRef<HTMLUListElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLUListElement>(null);
  const [moved, setMoved] = React.useState<number[]>([]);
  const [open, setOpen] = React.useState(false);
  const menuId = React.useId();

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
    setMoved((was) => (was.join() === next.join() ? was : next));
    if (!next.length) setOpen(false);
  }, []);
  React.useLayoutEffect(fit);
  React.useLayoutEffect(() => {
    const ul = list.current;
    if (!ul || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => fit());
    watch.observe(ul);
    void document.fonts?.ready.then(() => fit());
    return () => watch.disconnect();
  }, [fit]);

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
    } else if (e.key === 'Tab') close(false);
  };
  const onButtonKey = (e: React.KeyboardEvent) => {
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
        aria-expanded={open}
        aria-controls={menuId}
        data-current={moved.some((i) => links[i].props.active) || undefined}
        onClick={() => (open ? close(false) : show('first'))}
        onKeyDown={onButtonKey}
      >
        {copy.more}
        <span aria-hidden="true"> ▾</span>
      </button>
      <ul
        ref={menu}
        id={menuId}
        role="menu"
        aria-label={copy.more}
        hidden={!open}
        onKeyDown={onMenuKey}
      >
        {moved.map((i) => (
          <li key={links[i].key ?? i} role="none">
            <SectionLink {...links[i].props} item onClick={() => close(false)} />
          </li>
        ))}
      </ul>
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
