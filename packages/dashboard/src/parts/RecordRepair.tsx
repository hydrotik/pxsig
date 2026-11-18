import React from 'react';
import { Badge, Button } from '@ui';
import { type Data, pathsFor, served } from '../data';
import { type RecordRepairPlan, recordRepairPlan, repairRecords } from '../data/record-repair';
import { t } from '../copy';
import { useApproving } from '../link';
import * as s from '../dashboard.css';

/**
 * "Repair baseline records", beside the coverage problems while the ledger reports
 * `baseline-pair-mismatch`: lists the mismatched entries (the eligible ones with their baseline
 * image and why, the count of the others), and repairs the eligible ones only after a person
 * confirms. Needs the dashboard link: without it the action is shown disabled with why. The server
 * re-plans and writes only the listed entries still eligible with the same bytes. It approves no
 * change; the entries that are not eligible are reviewed one at a time.
 */
export function RecordRepair({ data }: { data: Data }) {
  const approving = useApproving();
  const [plan, setPlan] = React.useState<RecordRepairPlan | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const found = data.integrity?.setup.some(
    (x) => x.code === 'baseline-pair-mismatch' && (x.count ?? 0) > 0
  );
  if (!served || (!found && !plan && !msg)) return null;
  const allowed = !!approving?.allowed;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(t('coverage.recordRepair.failed', { error: (e as Error).message }));
    }
    setBusy(false);
  };
  const list = () => run(async () => setPlan(await recordRepairPlan()));
  const confirm = (p: RecordRepairPlan) =>
    run(async () => {
      const r = await repairRecords(p.eligible);
      setPlan(null);
      setMsg(
        t('coverage.recordRepair.done', {
          count: r.repaired.length,
          skipped: r.notWritten.length,
          batch: r.batch ?? '—',
        })
      );
    });
  if (!plan)
    return (
      <span className={s.row}>
        <Button
          size="sm"
          emphasis="outline"
          onClick={list}
          disabled={busy || !allowed || !found}
          title={allowed ? undefined : t('coverage.recordRepair.needsLink')}
        >
          {busy ? t('coverage.recordRepair.listing') : t('coverage.recordRepair.list')}
        </Button>
        <span className={s.muted}>{t('coverage.recordRepair.note')}</span>
        {msg ? <span className={s.mono}>{msg}</span> : null}
      </span>
    );
  return (
    <section className={s.stack} aria-label={t('coverage.recordRepair.title')}>
      <strong>{t('coverage.recordRepair.title')}</strong>
      <span className={s.muted}>
        {t('coverage.recordRepair.summary', {
          count: plan.mismatched,
          eligible: plan.eligible.length,
          others: plan.ineligible.length,
        })}
      </span>
      {plan.eligible.length ? (
        <div className={s.cards}>
          {plan.eligible.map((x) => (
            <div key={x.id} className={`${s.storyCard} ${s.storyCardStatic}`}>
              <div className={s.thumb}>
                <img
                  src={pathsFor(data, x.id).before}
                  alt={t('coverage.recordRepair.imageAlt', { id: x.id })}
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className={s.cardBody}>
                <span className={s.cardId} title={x.id}>
                  {x.id}
                </span>
                <span className={s.muted}>{t('coverage.recordRepair.qualifies')}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {plan.ineligible.length ? (
        <span className={s.row}>
          <Badge tone="warning">
            {t('coverage.recordRepair.notEligible', { count: plan.ineligible.length })}
          </Badge>
          <span className={s.muted}>{t('coverage.recordRepair.reviewOthers')}</span>
        </span>
      ) : null}
      <span className={s.row}>
        {plan.eligible.length ? (
          <Button size="sm" onClick={() => confirm(plan)} disabled={busy || !allowed}>
            {busy
              ? t('coverage.recordRepair.repairing')
              : t('coverage.recordRepair.confirm', { count: plan.eligible.length })}
          </Button>
        ) : null}
        <Button size="sm" emphasis="outline" onClick={() => setPlan(null)} disabled={busy}>
          {t('coverage.recordRepair.cancel')}
        </Button>
      </span>
      {msg ? <span className={s.mono}>{msg}</span> : null}
    </section>
  );
}
