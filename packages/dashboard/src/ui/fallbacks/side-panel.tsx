/**
 * The side panel's plain renderings (fallbacks.tsx), the inspector's `<aside>` pattern: the panel
 * beside the main area, overlaid on it when the container is too narrow for both (side-panel.css.ts:
 * a container query, no media query), with a heading that names it and a close button.
 */
import React from 'react';
import { tokens as v } from '../tokens';
import { border, control, type F } from './base';
import * as sp from './side-panel.css';

const cx = (a: string, b?: string) => (b ? `${a} ${b}` : a);

export const SidePanelLayout: F<'SidePanelLayout'> = ({ className, children }) => (
  <div className={cx(sp.layout, className)}>{children}</div>
);

export const SidePanelMain: F<'SidePanelMain'> = ({ className, children }) => (
  <div className={cx(sp.main, className)}>{children}</div>
);

export const SidePanel: F<'SidePanel'> = ({
  open,
  onOpenChange,
  title,
  headingLevel = 3,
  closeLabel,
  className,
  children,
}) => {
  const id = React.useId();
  const heading = React.useRef<HTMLHeadingElement>(null);
  // Focus moves to the heading on open, and back to where it was on close.
  React.useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    heading.current?.focus();
    return () => back?.focus?.();
  }, [open]);
  if (!open) return null;
  const Heading = `h${headingLevel}` as const;
  return (
    // Escape from anything focused inside closes it; the keydown bubbles up to the panel.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the aside is not a control
    <aside
      aria-labelledby={id}
      className={cx(sp.panel, className)}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.stopPropagation();
        onOpenChange(false);
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: v.space['3'],
        padding: v.space['3'],
        border,
        borderRadius: v.radius.lg,
        background: v.color.surface,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: v.space['2'] }}>
        <Heading
          id={id}
          ref={heading}
          tabIndex={-1}
          style={{
            flex: 1,
            minInlineSize: 0,
            margin: 0,
            fontSize: v.fontSize.sm,
            fontWeight: v.fontWeight.semibold,
            overflowWrap: 'anywhere',
          }}
        >
          {title}
        </Heading>
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={() => onOpenChange(false)}
          style={{ ...control, inlineSize: '1.75rem', paddingInline: 0, cursor: 'pointer' }}
        >
          <span aria-hidden>×</span>
        </button>
      </div>
      <div className={sp.body}>{children}</div>
    </aside>
  );
};
