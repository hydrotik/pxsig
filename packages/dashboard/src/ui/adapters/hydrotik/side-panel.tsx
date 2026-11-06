/**
 * The reference adapter's side panel (contract 1.3.0): hydrotik's SidePanel pushed in on the right
 * of a ContentLayout, which its panel needs around the main area. Neither a resize handle nor an
 * expand button: the design system names both in fixed English, and the dashboard's copy lives in
 * en.json. The close button is the design system's, named from the contract. index.tsx passes the
 * design-system parts in (as slider.tsx), so every part the adapter uses is named in that one file.
 */
import React from 'react';
import type * as DS from '@hydrotik/design-system';
import type * as C from '../../contract';

/** The design-system parts the mapping uses. */
export interface PanelParts {
  Layout: typeof DS.ContentLayout;
  Main: typeof DS.ContentLayoutMain;
  Panel: typeof DS.SidePanel;
  Header: typeof DS.SidePanelHeader;
  Body: typeof DS.SidePanelBody;
  Close: typeof DS.SidePanelCloseButton;
}

export const sidePanel = (P: PanelParts) => {
  function SidePanel({
    open,
    onOpenChange,
    title,
    headingLevel = 3,
    closeLabel,
    className,
    children,
  }: C.SidePanelProps) {
    const ref = React.useRef<HTMLElement>(null);
    // Pushed in, the design system leaves focus where it was: the contract moves it into the
    // panel (the panel is focusable and named by its heading), and back on close.
    React.useEffect(() => {
      if (!open) return;
      const back = document.activeElement as HTMLElement | null;
      ref.current?.focus();
      return () => back?.focus?.();
    }, [open]);
    return (
      <P.Panel
        ref={ref}
        position="right"
        mode="push"
        open={open}
        onOpenChange={onOpenChange}
        resizable={false}
        defaultWidth={20}
        minWidth={20}
        maxWidth={20}
        className={className}
      >
        <P.Header title={title} headingLevel={headingLevel} showClose={false}>
          <P.Close aria-label={closeLabel} title={closeLabel} />
        </P.Header>
        <P.Body>{children}</P.Body>
      </P.Panel>
    );
  }
  return {
    // In the page's flow: as tall as its content (the layout fills its parent by default), on the
    // surface it sits on (its own background is the page's).
    SidePanelLayout: ({ className, children }: C.SidePanelLayoutProps) => (
      <P.Layout height="auto" className={className} style={{ backgroundColor: 'transparent' }}>
        {children}
      </P.Layout>
    ),
    // Not a second <main>, and the page scrolls, not the records.
    SidePanelMain: ({ className, children }: C.SidePanelMainProps) => (
      <P.Main as="div" scrollable={false} className={className}>
        {children}
      </P.Main>
    ),
    SidePanel,
  };
};
