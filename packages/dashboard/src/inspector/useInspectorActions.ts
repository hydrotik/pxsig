/**
 * The inspector's decisions (Inspector.tsx): approve, reject and undo, take a rule off the
 * accepted list, re-check the entry, approve the story; and the note they leave under the header.
 */
import React from 'react';
import {
  type Data,
  type Row,
  a11yAction,
  approveStory,
  recheck,
  reviewAction,
  statusOf,
  useCheckActivity,
} from '../data';
import { t } from '../copy';
import { NeedsLinkError } from '../link';
import type { InspectTarget } from './Inspector';

export function useInspectorActions({
  data,
  target,
  row,
  list,
  index,
  a11yMode,
  onNavigate,
  setBusy,
}: {
  data: Data;
  target: InspectTarget | null;
  row: Row | null;
  list: Row[];
  index: number;
  a11yMode: boolean;
  onNavigate: (t: InspectTarget) => void;
  setBusy: (busy: boolean) => void;
}) {
  const label = (action: 'approve' | 'reject' | 'unreview', a11y: boolean) =>
    t(
      `inspector.review.${action === 'unreview' ? 'undo' : a11y && action === 'approve' ? 'accept' : action}`
    );
  // A decision the server refused: without the dashboard link, the line under the header says how
  // to get it; anything else is an alert, as before.
  const refused = (e: unknown, action: string) =>
    e instanceof NeedsLinkError
      ? setNote(t('inspector.review.needsLink'))
      : alert(t('inspector.review.failed', { action, error: (e as Error).message }));
  const act = async (action: 'approve' | 'reject' | 'unreview', a11y = a11yMode) => {
    if (!row) return;
    setBusy(true);
    try {
      await (a11y
        ? a11yAction(action === 'approve' ? 'accept' : action, row.id)
        : reviewAction(action, row.id));
      if (action !== 'unreview' && a11y === a11yMode) {
        // The next undecided entry after this one, wrapping to the start of the list.
        const open = (r: Row) =>
          (a11yMode ? !data.a11yReview?.[r.id] : !r.pass && !data.review[r.id]) && r.id !== row.id;
        const next = [...list.slice(index + 1), ...list.slice(0, Math.max(index, 0))].find(open);
        if (next) onNavigate({ ...target!, row: next });
      }
    } catch (e) {
      refused(e, label(action, a11y));
    } finally {
      setBusy(false);
    }
  };

  // Take one rule off this entry's accepted list: it is reported as new and can be accepted again.
  const unaccept = async (rule: string) => {
    if (!row) return;
    setBusy(true);
    try {
      await a11yAction('unaccept', row.id, rule);
    } catch (e) {
      refused(e, t('inspector.a11y.unaccept'));
    } finally {
      setBusy(false);
    }
  };

  // Other modes / states of the same story: switch between them in place.
  const siblings =
    row && !target?.scenario
      ? (data.check?.rows ?? []).filter((r) => r.story === row.story && !r.skipped)
      : [];

  // Entries of this story waiting for a decision (every mode and state): one click approves them.
  const storyOpen = siblings.filter(
    (r) => ['changed', 'new'].includes(statusOf(r, data.review)) && !r.error
  );
  // What the last re-check or story approval did, shown under the header until the entry changes.
  const [note, setNote] = React.useState<string | null>(null);
  React.useEffect(() => setNote(null), [row?.id]);
  const activity = useCheckActivity();
  const checking = !!row && !!activity.running?.includes(row.id);
  const recheckOne = async () => {
    if (!row) return;
    setBusy(true);
    try {
      const r = await recheck([row.id]);
      setNote(
        [
          t('app.check.queued', { count: r.queued.length }),
          r.skipped?.length
            ? t('app.check.skipped', {
                list: r.skipped.map((x) => `${x.name}: ${x.why}`).join('; '),
              })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      );
    } catch (e) {
      alert(
        t('inspector.review.failed', {
          action: t('inspector.review.recheck'),
          error: (e as Error).message,
        })
      );
    } finally {
      setBusy(false);
    }
  };
  const approveAll = async () => {
    if (!row) return;
    setBusy(true);
    try {
      const r = await approveStory(row.story);
      const left = r.skipped.filter((x) => storyOpen.some((o) => o.id === x.id));
      setNote(
        [
          t('inspector.review.approveStoryDone', { count: r.approved.length, story: row.story }),
          left.length
            ? t('inspector.review.approveStoryLeft', {
                list: left.map((x) => `${x.id}: ${x.why}`).join('; '),
              })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      );
      // On to the next undecided entry of another story.
      const open = (x: Row) => !x.pass && !data.review[x.id] && x.story !== row.story;
      const next = [...list.slice(index + 1), ...list.slice(0, Math.max(index, 0))].find(open);
      if (next && target) onNavigate({ ...target, row: next });
    } catch (e) {
      refused(e, t('inspector.review.approveStory', { count: storyOpen.length }));
    } finally {
      setBusy(false);
    }
  };
  return { siblings, storyOpen, note, checking, act, unaccept, recheckOne, approveAll };
}
