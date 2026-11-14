/**
 * A request the server refused, said where it was asked: a short line in the page (an `output`, a status),
 * never a browser alert, which holds the page, with the button still busy, until it is closed.
 * The inspector says its own under the header (inspector/useInspectorActions.ts).
 */
import React from 'react';
import { t } from '../copy';
import * as s from '../dashboard.css';

export function useFailure() {
  const [failed, setFailed] = React.useState<string | null>(null);
  /** `action`: the button's label, for "{action} failed: {error}"; else the error alone. */
  const report = (e: unknown, action?: string) => {
    const error = (e as Error)?.message ?? String(e);
    setFailed(action ? t('inspector.review.failed', { action, error }) : error);
  };
  const note = failed ? <output className={s.small}>{failed}</output> : null;
  const clear = React.useCallback(() => setFailed(null), []);
  return { note, report, clear };
}
