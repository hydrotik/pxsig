import { Card, CardContent, CardDescription, CardHeader, CardTitle, StaticList, StaticListItem } from '@hydrotik/design-system';
import type { Data } from '../data';
import { t, codeCopy, type CopyKey } from '../copy';
import * as s from '../dashboard.css';

const STATUSES = ['pass', 'changed', 'new', 'approved', 'rejected', 'flaky', 'skipped', 'error'] as const;
/** Coverage codes in the order the ledger ranks them. */
const CODES = ['unregistered', 'render-error', 'never-checked', 'missing-baseline-image', 'legacy-format', 'unbaselined', 'missing-render', 'orphaned', 'changed', 'flaky', 'stale', 'a11y-new', 'skipped-unaffected', 'drift', 'excluded', 'ok'];
const KEYS: [string, CopyKey][] = [
  ['1–5', 'help.keys.mode'],
  ['F', 'help.keys.fit'],
  ['0', 'help.keys.actual'],
  ['+ −', 'help.keys.zoom'],
  ['N ⇧N', 'help.keys.change'],
  ['← →', 'help.keys.story'],
  ['A', 'help.keys.approve'],
  ['R', 'help.keys.reject'],
  ['Esc', 'help.keys.close'],
];
const COMMANDS: [string, CopyKey][] = [
  ['pxsig check --full', 'help.commands.check'],
  ['pxsig check --since main', 'help.commands.checkChanged'],
  ['pxsig serve --watch', 'help.commands.serve'],
  ['pxsig doctor', 'help.commands.doctor'],
  ['pxsig doctor --repair', 'help.commands.repair'],
];

/** A glossary: term on the left, its meaning beside it. */
const pairs = (rows: [string, string][], labelWidth = '35%') => (
  <StaticList labelWidth={labelWidth}>
    {rows.map(([term, meaning]) => (
      <StaticListItem key={term} label={term}>
        {meaning}
      </StaticListItem>
    ))}
  </StaticList>
);

/** Reference: the gate as configured, what each status means, shortcuts and commands. */
export function Help({ data }: { data: Data }) {
  const m = data.check?.manifest;
  const g = m?.gate ?? {};
  return (
    <div className={s.stack}>
      <Card>
        <CardHeader>
          <CardTitle>{t('help.gate.title')}</CardTitle>
          <CardDescription>{t('help.gate.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <StaticList>
            <StaticListItem label={t('help.gate.signature')}>{t('help.gate.signatureValue', { grid: m?.grid ?? 64 })}</StaticListItem>
            <StaticListItem label={t('help.gate.wholeImage')}>{t('help.gate.wholeImageValue', { minCells: g.minCells ?? 2, threshold: g.threshold ?? 32 })}</StaticListItem>
            <StaticListItem label={t('help.gate.detail')}>{t('help.gate.detailValue')}</StaticListItem>
            <StaticListItem label={t('help.gate.modes')}>{m?.modes ? Object.keys(m.modes).join(', ') : '—'}</StaticListItem>
            <StaticListItem label={t('help.gate.format')}>{t('help.gate.formatValue')}</StaticListItem>
          </StaticList>
        </CardContent>
      </Card>
      <div className={s.twoCol}>
        <Card>
          <CardHeader>
            <CardTitle>{t('help.statuses.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {pairs(STATUSES.map((x) => [t(`status.${x}`), t(`help.statuses.${x}`)]))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('help.coverage.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {pairs(CODES.map((code) => [codeCopy(code).title, codeCopy(code).help]))}
          </CardContent>
        </Card>
      </div>
      <div className={s.twoCol}>
        <Card>
          <CardHeader>
            <CardTitle>{t('help.keys.title')}</CardTitle>
            <CardDescription>{t('help.keys.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            {pairs(KEYS.map(([k, label]) => [k, t(label)]), '25%')}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('help.commands.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {pairs(COMMANDS.map(([c, label]) => [c, t(label)]), '45%')}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
