import { CopyValue } from '@ui';
import { type Data } from '../data';
import { type Approving, useApproving } from '../link';
import { t } from '../copy';
import * as s from '../dashboard.css';

/** Why the page cannot repair: another process holds the store, or it has no dashboard link. */
export type ReadOnly = { store: true } | { store: false; approving: NonNullable<Approving> };

/**
 * In place of "Run safe repairs" where the server would refuse the repair: the store held by
 * another process (repairs run there), or no dashboard link (the step that makes it available, in
 * the words and form the inspector uses for approving: the folder, the command, the link's timing).
 */
export function RepairLinkNote({ why }: { why: ReadOnly }) {
  if (why.store) return <span className={s.muted}>{t('coverage.banner.storeHeld')}</span>;
  return (
    <span className={s.row}>
      <span className={s.muted}>
        {t('coverage.banner.readOnly', { folder: why.approving.folder })}
      </span>
      <CopyValue value={why.approving.command} />
      <span className={s.muted}>{t('inspector.review.linkTiming')}</span>
    </span>
  );
}

/**
 * Whether the page is read only for repairs, and why: the server does not hold the store lock
 * (`storeHeld: false`; absent from an older server or a static report), else the page holds no
 * dashboard link. Null: a repair can run.
 */
export function useReadOnly(data: Pick<Data, 'storeHeld'>): ReadOnly | null {
  const approving = useApproving();
  if (data.storeHeld === false) return { store: true };
  return approving?.allowed === false ? { store: false, approving } : null;
}
