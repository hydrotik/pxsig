/**
 * The side panel of Diagnostics › React › Compiler: one function's alert (the engine's sentence),
 * its diagnostics (rule, reason, line, group, whether it stops compilation), how it stood at the
 * base, the entries its file reaches (each opens the inspector) and what the comparison used.
 */
import React from 'react';
import { Button, CopyValue, KeyValueItem, KeyValueList, Link } from '@ui';
import { t } from '../../copy';
import type { Data, ReactDiagnostic, ReactFunction, ReactReport, Row } from '../../data';
import * as s from '../../dashboard.css';
import { ChangeBadge, outcomeLabel, pathOf, ruleDoc } from './shared';

/** Entries listed before "… n more". */
const FIRST = 5;

/** The group a diagnostic's category belongs to (design 4.2). */
function groupOf(category: string) {
  const c = category.toLowerCase();
  if (/suppress/.test(c)) return 'suppressed';
  if (/todo|unsupported|invariant|limitation/.test(c)) return 'limitation';
  if (/config|gating|setup/.test(c)) return 'setup';
  if (/incompatible|library/.test(c)) return 'library';
  return 'rules';
}

function Diagnostic({ d }: { d: ReactDiagnostic }) {
  const rule = d.rule || d.category;
  return (
    <KeyValueList>
      <KeyValueItem label={t('diagnostics.react.side.rule')}>
        {d.rule ? (
          <Link href={ruleDoc(d.rule)} external>
            {t('diagnostics.react.side.ruleDoc', { rule })}
          </Link>
        ) : (
          rule
        )}
      </KeyValueItem>
      <KeyValueItem label={t('diagnostics.react.side.reason')}>{d.reason}</KeyValueItem>
      {d.line != null ? (
        <KeyValueItem label={t('diagnostics.react.side.line')}>{d.line}</KeyValueItem>
      ) : null}
      <KeyValueItem label={t('diagnostics.react.side.group')}>
        {t(
          `diagnostics.react.side.groups.${groupOf(d.category)}` as 'diagnostics.react.side.groups.rules'
        )}
      </KeyValueItem>
      <KeyValueItem label={t('diagnostics.react.side.stops')}>
        {t(d.stops ? 'diagnostics.react.side.yes' : 'diagnostics.react.side.no')}
      </KeyValueItem>
    </KeyValueList>
  );
}

export function CompilerPanel({
  data,
  report,
  fn,
  file,
  onOpen,
}: {
  data: Data;
  report: ReactReport;
  fn: ReactFunction;
  file: ReactReport['files'][number] | undefined;
  onOpen: (row: Row, list: Row[]) => void;
}) {
  const [more, setMore] = React.useState(false);
  const path = pathOf(fn);
  const where = `${path}:${fn.line}`;
  const ref = report.base?.since ?? 'main';
  const alert = report.alerts.find((a) => a.id === fn.id);
  const diags = fn.head?.diagnostics ?? [];
  const before = fn.change === 'reason-changed' ? (fn.base?.diagnostics ?? []) : [];
  const rows = new Map((data.check?.rows ?? []).map((r) => [r.id, r]));
  const reached = (file?.ids ?? []).map((id) => rows.get(id)).filter((r): r is Row => !!r);
  const listed = more ? reached : reached.slice(0, FIRST);
  const opts = report.backend.options;
  return (
    <div className={s.stack}>
      <section className={s.sideSection}>
        <span className={s.row}>
          <ChangeBadge change={fn.change} />
          <CopyValue value={where} />
        </span>
      </section>
      {alert ? (
        <section className={s.sideSection}>
          <h4 className={s.sectionTitle}>{t('diagnostics.react.side.alert')}</h4>
          <span className={s.small}>{alert.text}</span>
        </section>
      ) : null}
      {diags.length ? (
        <section className={s.sideSection}>
          <h4 className={s.sectionTitle}>
            {t('diagnostics.react.side.diagnostics', { count: diags.length })}
          </h4>
          {diags.map((d, i) => (
            <Diagnostic key={i} d={d} />
          ))}
        </section>
      ) : null}
      <section className={s.sideSection}>
        <h4 className={s.sectionTitle}>{t('diagnostics.react.side.atBase', { ref })}</h4>
        {fn.base ? (
          <span className={s.small}>
            {fn.base.memoSlots != null
              ? t('diagnostics.react.side.memoSlots', {
                  outcome: outcomeLabel(fn.base.outcome),
                  count: fn.base.memoSlots,
                })
              : outcomeLabel(fn.base.outcome)}
          </span>
        ) : (
          <span className={s.small}>{t('diagnostics.react.side.notAtBase', { ref })}</span>
        )}
        {before.map((d, i) => (
          <Diagnostic key={i} d={d} />
        ))}
      </section>
      <section className={s.sideSection}>
        <h4 className={s.sectionTitle}>
          {t('diagnostics.react.side.entries', { count: file?.entries ?? 0 })}
        </h4>
        {file?.all ? (
          <span className={s.small}>{t('diagnostics.react.side.entriesAll')}</span>
        ) : (
          <>
            {listed.map((r) => (
              <Button
                key={r.id}
                size="sm"
                emphasis="ghost"
                title={t('diagnostics.react.side.entryOpen', { id: r.id })}
                onClick={() => onOpen(r, reached)}
              >
                <span className={s.mono}>{r.id}</span>
              </Button>
            ))}
            {!more && reached.length > FIRST ? (
              <Button size="sm" emphasis="ghost" onClick={() => setMore(true)}>
                {t('diagnostics.react.side.entriesMore', { count: reached.length - FIRST })}
              </Button>
            ) : null}
          </>
        )}
      </section>
      <section className={s.sideSection}>
        <h4 className={s.sectionTitle}>{t('diagnostics.react.side.comparison')}</h4>
        <KeyValueList>
          <KeyValueItem label={t('diagnostics.react.side.base')}>
            {report.base ? `${report.base.since} (${report.base.commit})` : '—'}
          </KeyValueItem>
          <KeyValueItem label={t('diagnostics.react.side.compiler')}>
            {report.backend.name === 'oxc'
              ? t('diagnostics.react.side.builtIn', { version: report.backend.compiler })
              : report.backend.compiler}
          </KeyValueItem>
          {report.backend.babel ? (
            <KeyValueItem label={t('diagnostics.react.side.babel')}>
              {report.backend.babel}
            </KeyValueItem>
          ) : null}
          <KeyValueItem label={t('diagnostics.react.side.options')}>
            {t('diagnostics.react.side.optionsValue', {
              mode: opts.compilationMode ?? 'infer',
              target: opts.target ?? 'auto',
              lint: t(
                opts.lint === false ? 'diagnostics.react.side.offWord' : 'diagnostics.react.side.on'
              ),
            })}
          </KeyValueItem>
        </KeyValueList>
      </section>
    </div>
  );
}
