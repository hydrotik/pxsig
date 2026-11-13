/**
 * The inspector's decisions (Inspector.tsx): approve, reject (with its reason) and undo, dismiss
 * an earlier rejection's reason, take a rule off the accepted list, re-check the entry, approve the
 * story; and the note they leave under the header.
 */
import React from 'react';
import {
  type Data,
  type Row,
  a11yAction,
  approveStory,
  dismissRejection,
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
  // A decision the server refused: the line under the header says why (without the dashboard link,
  // how to get it), and the inspector stays usable. Never a browser alert: one blocks the page with
  // the button still reading "Approving…" until it is closed.
  const refused = (e: unknown, action: string) =>
    setNote(
      e instanceof NeedsLinkError
        ? t('inspector.review.needsLink')
        : t('inspector.review.failed', { action, error: (e as Error).message })
    );
  // The decision under way, which its button names ("Approving…") until the server answers.
  const [pending, setPending] = React.useState<'approve' | 'reject' | null>(null);
  // What the server said it did not keep (a reject's reason while reports/ is not git-ignored):
  // shown under the header until the next decision, past the move to the next entry.
  const [notice, setNotice] = React.useState<string | null>(null);
  // The entries decided here (`render:<id>`, `a11y:<id>` → the action), before the server's
  // refreshed data says so: a quick decision after another must not move back to the one just
  // decided, nor approve it twice.
  const decidedHere = React.useRef(new Map<string, string>());
  const key = (a11y: boolean, id: string) => `${a11y ? 'a11y' : 'render'}:${id}`;
  /**
   * `note`: a reject's reason. `stay`: an edited reason, on the entry already rejected, keeps the
   * inspector on it.
   */
  const act = async (
    action: 'approve' | 'reject' | 'unreview',
    a11y = a11yMode,
    { note, stay = false }: { note?: string; stay?: boolean } = {}
  ) => {
    if (!row) return;
    // As the button: an entry already approved is not approved again (the A key).
    const current = a11y ? data.a11yReview?.[row.id] : data.review[row.id];
    if (
      action === 'approve' &&
      (current?.state === 'approved' || decidedHere.current.get(key(a11y, row.id)) === 'approve')
    )
      return;
    // Masks no approval passes: no decision is sent (the A and R keys), as the buttons are not
    // offered; the server refuses them too.
    if (action !== 'unreview' && row.masksBlocked && !row.pass) return;
    setBusy(true);
    setNotice(null);
    setNote(null);
    if (action !== 'unreview') setPending(action);
    try {
      const answer = await (a11y
        ? a11yAction(action === 'approve' ? 'accept' : action, row.id, undefined, note)
        : reviewAction(action, row.id, note));
      setNotice(answer?.notice ?? null);
      if (action === 'unreview') decidedHere.current.delete(key(a11y, row.id));
      else decidedHere.current.set(key(a11y, row.id), action);
      if (action !== 'unreview' && a11y === a11yMode && !stay) {
        // The next undecided entry after this one, wrapping to the start of the list.
        const open = (r: Row) =>
          (a11yMode ? !data.a11yReview?.[r.id] : !r.pass && !data.review[r.id]) &&
          !decidedHere.current.has(key(a11yMode, r.id));
        const next = [...list.slice(index + 1), ...list.slice(0, Math.max(index, 0))].find(open);
        if (next) onNavigate({ ...target!, row: next });
      }
    } catch (e) {
      refused(e, label(action, a11y));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  // Close an open rejection after a re-check, with no decision (Dismiss reason). `dismissed`
  // names it, so the rejected note can say so once the rejection is gone from the data.
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const dismiss = async (kind: 'visual' | 'a11y') => {
    if (!row) return;
    setBusy(true);
    try {
      await dismissRejection(row.id, kind);
      setDismissed(`${kind}:${row.id}`);
    } catch (e) {
      refused(e, t('inspector.rejection.dismiss'));
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

  // Entries of this story waiting for a decision (every mode and state): one click approves them,
  // only when the project allows it (`approvals.byStory`, off by default: one entry, one decision).
  const storyOpen = data.approvals?.byStory
    ? siblings.filter(
        (r) => ['changed', 'new'].includes(statusOf(r, data.review)) && !r.error && !r.masksBlocked
      )
    : [];
  // What the last re-check or story approval did, shown under the header until the entry changes.
  const [note, setNote] = React.useState<string | null>(null);
  // This entry's re-check, from the click until its run ends (the server's `check` events): then
  // "Queued" goes, and only what was not checked stays.
  const run = React.useRef<{ ran?: boolean; ended?: boolean; note?: string; after?: string }>(null);
  React.useEffect(() => {
    run.current = null;
    setNote(null);
  }, [row?.id]);
  const activity = useCheckActivity();
  const checking = !!row && !!activity.running?.includes(row.id);
  React.useEffect(() => {
    const r = run.current;
    if (!r) return;
    if (checking) r.ran = true;
    else if (r.ran && !r.ended) {
      r.ended = true;
      if (r.note) setNote((n) => (n === r.note ? r.after || null : n));
    }
  }, [checking]);
  const recheckOne = async () => {
    if (!row) return;
    setBusy(true);
    const mine: NonNullable<typeof run.current> = {};
    run.current = mine;
    try {
      const r = await recheck([row.id]);
      mine.after = r.skipped?.length
        ? t('app.check.skipped', { list: r.skipped.map((x) => `${x.name}: ${x.why}`).join('; ') })
        : '';
      mine.note = [t('app.check.queued', { count: r.queued.length }), mine.after]
        .filter(Boolean)
        .join(' · ');
      setNote(mine.ended ? mine.after || null : mine.note);
    } catch (e) {
      refused(e, t('inspector.review.recheck'));
    } finally {
      setBusy(false);
    }
  };
  const approveAll = async () => {
    if (!row) return;
    setBusy(true);
    try {
      const r = await approveStory(row.story);
      for (const id of r.approved) decidedHere.current.set(key(false, id), 'approve');
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
      const open = (x: Row) =>
        !x.pass &&
        !data.review[x.id] &&
        !decidedHere.current.has(key(false, x.id)) &&
        x.story !== row.story;
      const next = [...list.slice(index + 1), ...list.slice(0, Math.max(index, 0))].find(open);
      if (next && target) onNavigate({ ...target, row: next });
    } catch (e) {
      refused(e, t('inspector.review.approveStory', { count: storyOpen.length }));
    } finally {
      setBusy(false);
    }
  };
  return {
    siblings,
    storyOpen,
    note,
    notice,
    checking,
    pending,
    act,
    dismiss,
    dismissed,
    unaccept,
    recheckOne,
    approveAll,
  };
}
