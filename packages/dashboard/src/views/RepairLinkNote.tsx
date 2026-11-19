import { CopyValue } from '@ui';
import { type Approving, useApproving } from '../link';
import { t } from '../copy';
import * as s from '../dashboard.css';

/**
 * In place of "Run safe repairs" on a read-only page (no dashboard link): the step that makes the
 * repair available, in the words and form the inspector uses for approving (the folder, the command
 * to copy, the link's timing).
 */
export function RepairLinkNote({ approving }: { approving: NonNullable<Approving> }) {
  return (
    <span className={s.row}>
      <span className={s.muted}>{t('coverage.banner.readOnly', { folder: approving.folder })}</span>
      <CopyValue value={approving.command} />
      <span className={s.muted}>{t('inspector.review.linkTiming')}</span>
    </span>
  );
}

/** The page's approving state when it is read only (no dashboard link), else null. */
export function useReadOnly(): NonNullable<Approving> | null {
  const approving = useApproving();
  return approving?.allowed === false ? approving : null;
}
