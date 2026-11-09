/**
 * The rejected note under the inspector's header (Inspector.tsx). On a rejected entry: the reason
 * ("Rejected. Reason: …"), the re-check command, Edit reason and Copy for an agent. On an entry
 * checked again since its rejection (it differs still, and waits for a decision): "Rejected
 * earlier", with Dismiss reason. Also what the server did not keep: a reason while the store's
 * reports/ is not git-ignored, and a rejection packet it could not write.
 */
import React from 'react';
import { Button, CopyValue } from '@ui';
import type { A11yDecision, Data, Rejection, ReviewEntry } from '../data';
import { t } from '../copy';
import * as s from '../dashboard.css';

/** Copies `value` (an agent's paragraph); says so for a moment after. */
export function CopyText({ value, title }: { value: string; title?: string }) {
  const [done, setDone] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard refused: nothing copied, the button says nothing */
    }
  };
  return (
    <Button size="sm" emphasis="outline" title={title} onClick={copy}>
      {t(done ? 'inspector.rejection.copied' : 'inspector.rejection.copyPrompt')}
    </Button>
  );
}

/** The open rejection of `id` (served data only). */
export const rejectionOf = (data: Data, a11y: boolean, id: string): Rejection | undefined =>
  data.rejections?.[a11y ? 'a11y' : 'visual']?.[id];

/** Why the packet is missing, as one sentence. */
const packetLine = (why: string) =>
  t(
    why.startsWith('not written')
      ? 'inspector.rejection.packetError'
      : 'inspector.rejection.packetFailed',
    {
      why,
    }
  );

export function RejectedNote({
  data,
  id,
  a11y,
  review,
  busy,
  canReview,
  onEdit,
  onDismiss,
  dismissed = false,
}: {
  data: Data;
  id: string;
  a11y: boolean;
  /** The entry's decision of this kind. */
  review: ReviewEntry | A11yDecision | undefined;
  busy: boolean;
  canReview: boolean;
  onEdit: (note: string) => void;
  onDismiss: () => void;
  /** Dismiss reason closed this entry's rejection: said once the data no longer has it. */
  dismissed?: boolean;
}) {
  const record = rejectionOf(data, a11y, id);
  const rejected = review?.state === 'rejected';
  if (dismissed && !record && !rejected)
    return (
      <output className={s.note}>
        <span>{t('inspector.rejection.dismissed')}</span>
      </output>
    );
  // An approval or an accept closes the rejection: nothing to say.
  if ((!rejected && !record) || (review && !rejected)) return null;
  const note = record?.note ?? (rejected ? review?.note : undefined) ?? null;
  const prompt = record?.prompt ? (
    <CopyText value={record.prompt} title={t('inspector.rejection.copyPromptTitle')} />
  ) : null;
  const extra = (
    <>
      {rejected && review?.noteKept === false ? (
        <span>
          {t('inspector.rejection.notKept', { folder: `${data.store ?? '.pxsig'}/reports` })}
        </span>
      ) : null}
      {record?.packetError ? (
        <span className={s.muted}>{packetLine(record.packetError)}</span>
      ) : null}
    </>
  );
  if (!rejected)
    return (
      <div className={s.note}>
        <span>
          {note
            ? t('inspector.rejection.earlier', { note })
            : t('inspector.rejection.earlierNoReason')}
        </span>
        {canReview ? (
          <Button
            size="sm"
            emphasis="ghost"
            disabled={busy}
            onClick={onDismiss}
            title={t('inspector.rejection.dismissTitle')}
          >
            {t('inspector.rejection.dismiss')}
          </Button>
        ) : null}
        {prompt}
        {extra}
      </div>
    );
  return (
    <div className={s.note}>
      {note ? (
        <>
          <span>
            {t(a11y ? 'inspector.rejection.a11yRejected' : 'inspector.rejection.rejected', {
              note,
            })}
          </span>
          <span>{t('inspector.rejection.next')}</span>
        </>
      ) : (
        <span>{t(a11y ? 'inspector.a11yRejectedNote' : 'inspector.rejectedNote')}</span>
      )}
      <CopyValue value={`pxsig check ${id}`} />
      {canReview ? (
        <Button size="sm" emphasis="ghost" disabled={busy} onClick={() => onEdit(note ?? '')}>
          {t('inspector.rejection.edit')}
        </Button>
      ) : null}
      {prompt}
      {extra}
    </div>
  );
}
