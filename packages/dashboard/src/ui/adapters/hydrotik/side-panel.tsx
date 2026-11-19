/**
 * The reference adapter's side panel (contract 1.3.0): hydrotik's SidePanel on the right of a
 * ContentLayout, in its `auto` mode: pushed in beside the main area while the layout is at least
 * its `lg` step wide, overlaid on it below that. Focus moves into it on open and back on close
 * (`focusOnOpen`). Neither a resize handle nor an expand button. The close button is the design
 * system's, named from the contract. index.tsx passes the design-system parts in (as
 * text-field.tsx), so every part the adapter uses is named in that one file.
 */
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
    return (
      <P.Panel
        position="right"
        mode="auto"
        overlayBelow="lg"
        focusOnOpen
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
    // surface it sits on.
    SidePanelLayout: ({ className, children }: C.SidePanelLayoutProps) => (
      <P.Layout height="auto" transparent className={className}>
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
