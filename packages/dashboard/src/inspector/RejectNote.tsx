/**
 * The reason's row (Inspector.tsx): Reject, R, the side panel's Accessibility Reject and the
 * Storybook panel's Reject open it under the header, in the rejected note's place. Enter (or its
 * Reject) rejects with the reason, an empty one too; Esc or Cancel closes it with no decision.
 * Edit reason opens it on a rejected entry, prefilled, and stays on that entry. With
 * `rejections.note.ask: false` (pxsig.config.json) Reject decides at once, with no reason.
 */
import React from 'react';
import { Button, TextField } from '@ui';
import type { Data, Row } from '../data';
import { t } from '../copy';
import * as s from '../dashboard.css';

/** One line, at most 280 characters (the server cuts it again). */
export const NOTE_MAX = 280;

/** The inspector's decision, with a reject's reason (useInspectorActions.ts `act`). */
export type Act = (
  action: 'approve' | 'reject' | 'unreview',
  a11y?: boolean,
  o?: { note?: string; stay?: boolean }
) => Promise<void>;

/** The row while it is open: the decision it is for, the text so far, and whether it edits one. */
export interface Asking {
  a11y: boolean;
  value: string;
  edit: boolean;
}

/**
 * `decide` is `act` for the buttons and keys: a reject without a reason opens the row instead
 * (unless the project rejects at once); `edit` opens it prefilled; `submit` rejects.
 */
export function useRejectNote({
  data,
  row,
  act,
  a11yMode,
}: {
  data: Data;
  row: Row | null;
  act: Act;
  a11yMode: boolean;
}) {
  const ask = data.settings?.rejections?.note?.ask !== false;
  // Held with the entry it is for: after a move to another entry the row is closed.
  const [held, setHeld] = React.useState<[string, Asking] | null>(null);
  const asking = held && held[0] === row?.id ? held[1] : null;
  const setAsking = (a: Asking | null) => setHeld(a && row ? [row.id, a] : null);
  const decide: Act = (action, a11y = a11yMode, o) => {
    if (action === 'reject' && ask && !o) {
      setAsking({ a11y, value: '', edit: false });
      return Promise.resolve();
    }
    setAsking(null);
    return act(action, a11y, o);
  };
  const edit = (a11y: boolean, value: string) => setAsking({ a11y, value, edit: true });
  const submit = (value: string) => {
    if (!asking) return;
    setAsking(null);
    void act('reject', asking.a11y, { note: value, stay: asking.edit });
  };
  return { asking, setAsking, decide, edit, submit };
}

/** The row: Reason (the field, the row's width), Reject and Cancel. */
export function RejectNoteRow({
  asking,
  setAsking,
  submit,
  busy,
}: {
  asking: Asking | null;
  setAsking: (a: Asking | null) => void;
  submit: (value: string) => void;
  busy: boolean;
}) {
  if (!asking) return null;
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Esc in the field inside cancels the row
    <fieldset
      className={s.noteRow}
      aria-label={t(
        asking.a11y ? 'inspector.rejection.a11yRowLabel' : 'inspector.rejection.rowLabel'
      )}
      // Esc cancels the row, not the inspector: the dialog's own Esc never sees it.
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        setAsking(null);
      }}
    >
      <span className={s.noteField}>
        <TextField
          label={t('inspector.rejection.reason')}
          value={asking.value}
          onValueChange={(value) => setAsking({ ...asking, value })}
          maxLength={NOTE_MAX}
          placeholder={t('inspector.rejection.placeholder')}
          onSubmit={(value) => !busy && submit(value)}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the row opens on Reject or R, to type the reason at once
          autoFocus
        />
      </span>
      <Button
        size="sm"
        disabled={busy}
        onClick={() => submit(asking.value)}
        title={t('inspector.rejection.submitTitle')}
      >
        {t('inspector.review.reject')}
      </Button>
      <Button size="sm" emphasis="ghost" onClick={() => setAsking(null)}>
        {t('inspector.rejection.cancel')}
      </Button>
    </fieldset>
  );
}
