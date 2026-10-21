import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hydrotik/design-system';
import type { Data } from '../data';
import { Schematic, type Layout } from '../parts/Schematic';
import { Icons } from '@hydrotik/design-system';
import { t, codeCopy, type CopyKey } from '../copy';
import * as s from '../dashboard.css';

interface Item {
  term: React.ReactNode;
  meaning: string;
  /** Regions of the drawing this row is about. */
  at: string[];
  /** The drawing for this row, when a section spans both screens. */
  layout?: Layout;
}

/**
 * One reference section: its terms on the left, a drawing of the screen on the right. Pointing at
 * a row (or focusing it) highlights where that thing appears.
 */
function Section({ title, description, layout, items, wide = '35%' }: { title: string; description: string; layout?: Layout; items: Item[]; wide?: string }) {
  const [active, setActive] = React.useState<number | null>(null);
  const shown = active == null ? null : items[active];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className={layout ? s.helpSection : undefined}>
          <dl className={s.helpRows} style={{ gridTemplateColumns: `minmax(0, ${wide}) minmax(0, 1fr)` }} onMouseLeave={() => setActive(null)}>
            {items.map((x, i) => (
              <div
                key={i}
                className={s.helpRow}
                data-active={active === i || undefined}
                tabIndex={layout ? 0 : undefined}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                <dt>{x.term}</dt>
                <dd>{x.meaning}</dd>
              </div>
            ))}
          </dl>
          {layout ? (
            <div className={s.helpDrawing}>
              <Schematic layout={shown?.layout ?? layout} active={shown?.at ?? []} />
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

const STATUSES = ['pass', 'changed', 'new', 'approved', 'rejected', 'flaky', 'skipped', 'error'] as const;
/** Coverage codes in the order the ledger ranks them. */
const CODES = ['unregistered', 'render-error', 'never-checked', 'missing-baseline-image', 'legacy-format', 'unbaselined', 'missing-render', 'orphaned', 'changed', 'flaky', 'stale', 'a11y-new', 'skipped-unaffected', 'drift', 'excluded', 'ok'];
const TABS = ['overview', 'review', 'coverage', 'a11y', 'runs', 'help'] as const;
const INSPECTOR: [string, string[]][] = [
  ['progress', ['session']],
  ['entry', ['ins-title']],
  ['review', ['ins-review']],
  ['note', ['ins-note']],
  ['modes', ['ins-modes']],
  ['changes', ['ins-changenav', 'ins-stage']],
  ['pixel', ['ins-pixel']],
  ['pixelChanges', ['ins-changes']],
  ['metrics', ['ins-metrics']],
  ['sigs', ['ins-sigs']],
  ['a11y', ['ins-a11y']],
  ['files', ['ins-files']],
];
const A11Y: [string, Layout, string[]][] = [
  ['scan', 'inspector', ['ins-a11y']],
  ['accepted', 'inspector', ['ins-a11y']],
  ['new', 'dashboard', ['open-items', 'card-flags', 'nav-a11y']],
  ['effect', 'dashboard', ['cards', 'header-status']],
  ['accepting', 'inspector', ['ins-review']],
];
const KEYS: [string, CopyKey, string[]][] = [
  ['1–5', 'help.keys.mode', ['ins-modes']],
  ['F', 'help.keys.fit', ['ins-zoom']],
  ['0', 'help.keys.actual', ['ins-zoom']],
  ['+ −', 'help.keys.zoom', ['ins-zoom']],
  ['N ⇧N', 'help.keys.change', ['ins-changenav']],
  ['← →', 'help.keys.story', ['ins-storynav']],
  ['A', 'help.keys.approve', ['ins-review']],
  ['R', 'help.keys.reject', ['ins-review']],
  ['Esc', 'help.keys.close', ['ins-close']],
];
const COMMANDS: [string, CopyKey][] = [
  ['pxsig check --full', 'help.commands.check'],
  ['pxsig check --since main', 'help.commands.checkChanged'],
  ['pxsig serve --watch', 'help.commands.serve'],
  ['pxsig doctor', 'help.commands.doctor'],
  ['pxsig doctor --repair', 'help.commands.repair'],
];

/** Reference: what each part of the dashboard shows, with a drawing of where it is. */
export function Help({ data }: { data: Data }) {
  const m = data.check?.manifest;
  const g = m?.gate ?? {};
  return (
    <div className={s.stack}>
      <p className={s.lede}>{t('help.intro')}</p>
      <Section
        title={t('help.tabs.title')}
        description={t('help.tabs.description')}
        layout="dashboard"
        items={TABS.map((k) => ({ term: t(`tabs.${k}`), meaning: t(`help.tabs.rows.${k}.meaning`), at: [`nav-${k}`] }))}
      />
      <Section
        title={t('help.affordance.title')}
        description={t('help.affordance.description')}
        layout="dashboard"
        items={[
          { term: <span className={s.row}><Icons.ArrowDownLeft className={s.inlineIcon} aria-hidden="true" /> {t('help.affordance.filter.term')}</span>, meaning: t('help.affordance.filter.meaning'), at: ['cards'] },
          { term: <span className={s.row}><Icons.ArrowUpRight className={s.inlineIcon} aria-hidden="true" /> {t('help.affordance.navigate.term')}</span>, meaning: t('help.affordance.navigate.meaning'), at: ['cards', 'card-thumb'] },
        ]}
      />
      <Section
        title={t('help.statuses.title')}
        description={t('help.statuses.description')}
        layout="dashboard"
        items={STATUSES.map((x) => ({ term: t(`status.${x}`), meaning: t(`help.statuses.${x}`), at: ['card-status', 'card-edge'] }))}
      />
      <Section
        title={t('help.coverage.title')}
        description={t('help.coverage.description')}
        layout="dashboard"
        items={CODES.map((code) => ({ term: codeCopy(code).title, meaning: codeCopy(code).help, at: ['nav-coverage', 'card-flags'] }))}
      />
      <Section
        title={t('help.inspector.title')}
        description={t('help.inspector.description')}
        layout="inspector"
        items={INSPECTOR.map(([k, at]) => ({ term: t(`help.inspector.rows.${k}.term` as CopyKey), meaning: t(`help.inspector.rows.${k}.meaning` as CopyKey), at }))}
      />
      <Section
        title={t('help.a11y.title')}
        description={t('help.a11y.description')}
        layout="inspector"
        items={A11Y.map(([k, layout, at]) => ({ term: t(`help.a11y.rows.${k}.term` as CopyKey), meaning: t(`help.a11y.rows.${k}.meaning` as CopyKey), at, layout }))}
      />
      <Section
        title={t('help.gate.title')}
        description={t('help.gate.description')}
        layout="inspector"
        items={[
          { term: t('help.gate.signature'), meaning: t('help.gate.signatureValue', { grid: m?.grid ?? 64 }), at: ['ins-metrics', 'ins-sigs'] },
          { term: t('help.gate.wholeImage'), meaning: t('help.gate.wholeImageValue', { minCells: g.minCells ?? 2, threshold: g.threshold ?? 32 }), at: ['ins-metrics'] },
          { term: t('help.gate.detail'), meaning: t('help.gate.detailValue'), at: ['ins-metrics'] },
          { term: t('help.gate.modes'), meaning: m?.modes ? Object.keys(m.modes).join(', ') : '—', at: ['ins-title'] },
          { term: t('help.gate.format'), meaning: t('help.gate.formatValue'), at: ['ins-files'] },
        ]}
      />
      <Section title={t('help.keys.title')} description={t('help.keys.description')} layout="inspector" wide="20%" items={KEYS.map(([k, label, at]) => ({ term: k, meaning: t(label), at }))} />
      <Section title={t('help.commands.title')} description={t('help.commands.description')} wide="40%" items={COMMANDS.map(([c, label]) => ({ term: c, meaning: t(label), at: [] }))} />
    </div>
  );
}
