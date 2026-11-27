/**
 * The reference adapter's Alert, AlertTitle and AlertDescription: the contract's alert block (the
 * integrity block, the report's Public notice) on hydrotik's Alert. The block stays on the page and
 * is not an announcement: hydrotik's non-live Alert (`live={false}`), a region named by the
 * contract's `label`. Its title is not a heading (`as="div"`). index.tsx passes the design-system
 * parts in (as side-panel.tsx), so every part the adapter uses is named in that one file.
 */
import type * as DS from '@hydrotik/design-system';
import type * as C from '../../contract';

/** The design-system parts the mapping uses. */
export interface AlertParts {
  Alert: typeof DS.Alert;
  Title: typeof DS.AlertTitle;
  Description: typeof DS.AlertDescription;
}

export const alertParts = (P: AlertParts) => ({
  Alert: ({ tone, label, children }: C.AlertProps) => (
    <P.Alert
      variant={tone === 'danger' ? 'destructive' : 'default'}
      live={false}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the design system's Alert renders its own div; the role makes it a region
      role="region"
      aria-label={label}
    >
      {children}
    </P.Alert>
  ),
  AlertTitle: ({ children }: C.AlertTitleProps) => <P.Title as="div">{children}</P.Title>,
  AlertDescription: ({ children }: C.AlertDescriptionProps) => (
    <P.Description>{children}</P.Description>
  ),
});
