/** The review session's summary (Inspector.tsx): what was decided and what to run next. */
import type { ReactNode } from 'react';
import { Button, CopyValue, Dialog, DialogTitle, KeyValueItem, KeyValueList } from '@ui';
import type { Data, Row } from '../data';
import { Cmd, t, tx } from '../copy';
import * as s from '../dashboard.css';

export function SessionSummary({
  progress,
  data,
  a11yMode,
  approvedRows,
  rejectedRows,
  onClose,
  onGo,
  setStay,
}: {
  progress: ReactNode;
  data: Data;
  a11yMode: boolean;
  approvedRows: Row[];
  rejectedRows: Row[];
  onClose: () => void;
  onGo?: (tab: string, filter?: string) => void;
  setStay: (stay: boolean) => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} className={s.summaryDialog}>
      {progress}
      <div className={s.summary}>
        <DialogTitle className={s.insTitle}>{t('inspector.session.complete')}</DialogTitle>
        <KeyValueList labelWidth="30%">
          <KeyValueItem
            label={t(a11yMode ? 'inspector.session.accepted' : 'inspector.session.approved', {
              count: approvedRows.length,
            })}
          >
            {a11yMode
              ? tx('inspector.session.acceptedNext', {
                  file: <Cmd>{`${data.store ?? '.pxsig'}/a11y.json`}</Cmd>,
                })
              : tx('inspector.session.approvedNext', {
                  store: <Cmd>{data.store ?? '.pxsig'}</Cmd>,
                })}
          </KeyValueItem>
          {rejectedRows.length ? (
            <KeyValueItem label={t('inspector.session.rejected', { count: rejectedRows.length })}>
              <span className={s.stack}>
                <span>
                  {t(
                    a11yMode
                      ? 'inspector.session.a11yRejectedNext'
                      : 'inspector.session.rejectedNext'
                  )}
                </span>
                <CopyValue value={`pxsig check ${rejectedRows.map((r) => r.id).join(' ')}`} />
              </span>
            </KeyValueItem>
          ) : null}
        </KeyValueList>
        <span className={s.row}>
          <Button size="sm" onClick={() => (onGo ? onGo('overview') : onClose())}>
            {t('inspector.session.back')}
          </Button>
          {rejectedRows.length && onGo ? (
            <Button
              size="sm"
              emphasis="outline"
              onClick={() => (a11yMode ? onGo('a11y') : onGo('stories', 'rejected'))}
            >
              {t('inspector.session.viewRejected')}
            </Button>
          ) : null}
          <Button size="sm" emphasis="ghost" onClick={() => setStay(true)}>
            {t('inspector.session.backToEntries')}
          </Button>
        </span>
      </div>
    </Dialog>
  );
}
