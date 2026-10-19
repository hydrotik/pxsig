import { StatusBadge } from '@hydrotik/design-system';
import type { statusOf } from '../data';

type S = ReturnType<typeof statusOf>;

/** One verdict → one StatusBadge preset, so every view says it the same way. */
export function StatusOf({ status }: { status: S }) {
  switch (status) {
    case 'pass':
      return <StatusBadge status="complete" label="Pass" />;
    case 'changed':
      return <StatusBadge status="review-required" label="Changed" />;
    case 'new':
      return <StatusBadge status="new" label="New" />;
    case 'approved':
      return <StatusBadge status="approved" />;
    case 'rejected':
      return <StatusBadge status="rejected" />;
    case 'flaky':
      return <StatusBadge status="paused" label="Flaky" tone="warning" />;
    case 'skipped':
      return <StatusBadge status="not-started" label="Unaffected" />;
    default:
      return <StatusBadge status="failed" label="Error" />;
  }
}
