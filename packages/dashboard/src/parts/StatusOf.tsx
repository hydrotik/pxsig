import { StatusBadge, type IconName, type Tone } from '@ui';
import type { statusOf } from '../data';
import { t, type CopyKey } from '../copy';

export type Verdict = ReturnType<typeof statusOf>;

/**
 * The dashboard's verdict vocabulary (contract rule 2): each verdict → one tone, icon and label.
 * Adapters render only those three, so every design system says a verdict the same way.
 */
export const VERDICT: Record<Verdict, { tone: Tone; icon: IconName; label: CopyKey }> = {
  pass: { tone: 'success', icon: 'check', label: 'status.pass' },
  changed: { tone: 'warning', icon: 'alert', label: 'status.changed' },
  new: { tone: 'info', icon: 'dot', label: 'status.new' },
  approved: { tone: 'success', icon: 'check', label: 'status.approved' },
  rejected: { tone: 'danger', icon: 'ban', label: 'status.rejected' },
  flaky: { tone: 'warning', icon: 'pause', label: 'status.flaky' },
  skipped: { tone: 'neutral', icon: 'dashed', label: 'status.skipped' },
  error: { tone: 'danger', icon: 'cross', label: 'status.error' },
};

/** One verdict → one status badge, so every view says it the same way. */
export function StatusOf({ status }: { status: Verdict }) {
  const v = VERDICT[status] ?? VERDICT.error;
  return <StatusBadge tone={v.tone} icon={v.icon} label={t(v.label)} />;
}
