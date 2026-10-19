import { StatusBadge } from '@hydrotik/design-system';
import type { statusOf } from '../data';
import { t } from '../copy';

type S = ReturnType<typeof statusOf>;

/** One verdict → one StatusBadge preset, so every view says it the same way. */
export function StatusOf({ status }: { status: S }) {
  switch (status) {
    case 'pass':
      return <StatusBadge status="complete" label={t('status.pass')} />;
    case 'changed':
      return <StatusBadge status="review-required" label={t('status.changed')} />;
    case 'new':
      return <StatusBadge status="new" label={t('status.new')} />;
    case 'approved':
      return <StatusBadge status="approved" label={t('status.approved')} />;
    case 'rejected':
      return <StatusBadge status="rejected" label={t('status.rejected')} />;
    case 'flaky':
      return <StatusBadge status="paused" label={t('status.flaky')} tone="warning" />;
    case 'skipped':
      return <StatusBadge status="not-started" label={t('status.skipped')} />;
    default:
      return <StatusBadge status="failed" label={t('status.error')} />;
  }
}
