/**
 * The reference adapter's Alert, AlertTitle and AlertDescription: the contract's alert block (the
 * integrity block, the report's Public notice) on hydrotik's Alert. index.tsx passes the
 * design-system parts in (as slider.tsx), so every part the adapter uses is named in that one file.
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
      aria-label={label}
      style={{ boxSizing: 'border-box' }}
    >
      {children}
    </P.Alert>
  ),
  // The design system's title is an h5; an alert's title is not a heading (the contract), so its role is removed.
  AlertTitle: ({ children }: C.AlertTitleProps) => <P.Title role="none">{children}</P.Title>,
  AlertDescription: ({ children }: C.AlertDescriptionProps) => (
    <P.Description>{children}</P.Description>
  ),
});
