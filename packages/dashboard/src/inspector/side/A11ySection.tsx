/** The inspector's accessibility section (Inspector.tsx): the violations and the decision. */
import { Badge, Button, StatusBadge } from '@ui';
import { Cmd, t, tx } from '../../copy';
import * as s from '../../dashboard.css';
import { type Data, type Row, served } from '../../data';
import type { InspectTarget } from '../Inspector';

export function A11ySection({
  row,
  newA11y,
  target,
  canReview,
  busy,
  unaccept,
  a11yMode,
  a11yDecision,
  act,
}: {
  row: Row;
  newA11y: number;
  target: InspectTarget | null;
  canReview: boolean;
  busy: boolean;
  unaccept: (rule: string) => Promise<void>;
  a11yMode: boolean;
  a11yDecision: NonNullable<Data['a11yReview']>[string] | undefined;
  act: (action: 'approve' | 'reject' | 'unreview', a11y?: boolean) => Promise<void>;
}) {
  if (!row.a11y?.violations?.length) return null;
  return (
    <section className={s.sideSection}>
      <h3 className={s.sectionTitle}>
        {t('inspector.sections.a11y', { count: row.a11y.violations.length })}
      </h3>
      <span className={s.muted}>
        {newA11y
          ? served && !target?.scenario
            ? t('inspector.a11y.stateNew', { count: newA11y })
            : tx('inspector.a11y.stateNewStatic', {
                count: newA11y,
                command: <Cmd>pxsig serve</Cmd>,
              })
          : t('inspector.a11y.stateAccepted')}
      </span>
      <ul className={s.resources}>
        {row.a11y.violations.map((v) => (
          <li key={v.id} className={s.a11yItem}>
            <StatusBadge
              icon="dot"
              label={v.impact ?? 'n/a'}
              tone={v.impact === 'critical' || v.impact === 'serious' ? 'danger' : 'warning'}
            />
            <span className={s.a11yRule} title={v.help}>
              {v.id} · {t('inspector.a11y.nodes', { count: v.nodes })}
            </span>
            {(row.a11y?.baseline ? !row.a11y.baseline.includes(v.id) : newA11y > 0) ? (
              <Badge tone="danger">{t('inspector.a11y.new')}</Badge>
            ) : (
              <>
                <Badge>{t('inspector.a11y.accepted')}</Badge>
                {canReview ? (
                  <Button
                    size="sm"
                    emphasis="ghost"
                    disabled={busy}
                    onClick={() => unaccept(v.id)}
                    title={t('inspector.a11y.unacceptTitle')}
                  >
                    {t('inspector.a11y.unaccept')}
                  </Button>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      {canReview && !a11yMode && (newA11y || a11yDecision) ? (
        <span className={s.row}>
          {a11yDecision ? (
            <>
              <Badge tone={a11yDecision.state === 'accepted' ? 'neutral' : 'danger'}>
                {t(
                  a11yDecision.state === 'accepted'
                    ? 'inspector.review.a11yAccepted'
                    : 'inspector.review.a11yRejected'
                )}
              </Badge>
              <Button
                size="sm"
                emphasis="ghost"
                disabled={busy}
                onClick={() => act('unreview', true)}
              >
                {t('inspector.review.undo')}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                emphasis="outline"
                disabled={busy}
                onClick={() => act('reject', true)}
                title={t('inspector.review.rejectA11yTitle')}
              >
                {t('inspector.review.reject')}
              </Button>
              <Button
                size="sm"
                emphasis="outline"
                disabled={busy}
                onClick={() => act('approve', true)}
                title={t('inspector.review.acceptTitle')}
              >
                {newA11y
                  ? t('inspector.review.acceptCount', { count: newA11y })
                  : t('inspector.review.accept')}
              </Button>
            </>
          )}
        </span>
      ) : null}
    </section>
  );
}
