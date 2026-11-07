/**
 * What both React tabs (Diagnostics › React) share: the part chooser, the time label, the notes
 * for an analysis that is off or cannot run, and the copy of outcomes and changes.
 */
import { Alert, AlertDescription, AlertTitle, Badge, Link, SegmentedChoice, type Tone } from '@ui';
import { Cmd, type CopyKey, has, locale, t, tx } from '../../copy';
import {
  type Data,
  type ReactData,
  type ReactFunction,
  type ReactReport,
  served,
} from '../../data';
import * as s from '../../dashboard.css';

export type ReactPart = 'compiler' | 'renders';

/** The tab chooser at the start of each tab's toolbar. */
export const PartChoice = ({
  part,
  onPart,
}: {
  part: ReactPart;
  onPart: (p: ReactPart) => void;
}) => (
  <SegmentedChoice
    value={part}
    onValueChange={(v) => onPart(v as ReactPart)}
    label={t('diagnostics.react.parts')}
    options={(['compiler', 'renders'] as const).map((k) => ({
      value: k,
      label: t(`diagnostics.react.tabs.${k}`),
    }))}
  />
);

const when = (iso: string) => new Date(iso).toLocaleString();

/** "From the check at … · base main (4883bcd)": where the results come from and what they compare with. */
export function fromLabel(r: ReactReport, source: ReactData['source']) {
  const check = source === 'check';
  if (!r.base)
    return t(check ? 'diagnostics.react.fromCheckNoBase' : 'diagnostics.react.fromAnalysisNoBase', {
      date: when(r.generatedAt),
    });
  return t(check ? 'diagnostics.react.fromCheck' : 'diagnostics.react.fromAnalysis', {
    date: when(r.generatedAt),
    ref: r.base.since,
    commit: r.base.commit,
  });
}

/** An outcome's label, or "—" when the function is absent on that side. */
export const outcomeLabel = (o: string | undefined | null) =>
  t(
    (o && has(`diagnostics.react.compiler.outcome.${o}`)
      ? `diagnostics.react.compiler.outcome.${o}`
      : 'diagnostics.react.compiler.outcome.absent') as CopyKey
  );

/** Changes that are alerts, in the order the table sorts them. */
export const ALERT_ORDER = ['new-bailout', 'new-function-bailout', 'reason-changed', 'new-finding'];
const TONES: Record<string, Tone> = {
  'new-bailout': 'warning',
  'new-function-bailout': 'warning',
  'reason-changed': 'warning',
  'new-finding': 'info',
  fixed: 'success',
};

/** A change as a badge (text, so colour is never the only signal); none for "unchanged". */
export function ChangeBadge({ change }: { change: string | null }) {
  if (!change || !has(`diagnostics.react.compiler.change.${change}`)) return null;
  return (
    <Badge tone={TONES[change] ?? 'neutral'}>
      {t(`diagnostics.react.compiler.change.${change}` as CopyKey)}
    </Badge>
  );
}

/** A rule's page on react.dev: the same link as the React SARIF file's help. */
export const ruleDoc = (rule: string) =>
  `https://react.dev/reference/eslint-plugin-react-hooks/lints/${encodeURIComponent(rule)}`;

/** The help line every "off" note ends with: a link to Help. */
const HelpLine = ({
  k,
}: {
  k: 'diagnostics.react.off.help' | 'diagnostics.react.notInstalledHelp';
}) => <Link href="#help">{t(k)}</Link>;

/**
 * Why the compiler analysis (or, `whole`, all of React) does not run here, or null when it does.
 * The first switch that turns it off is named, as the server applies them.
 */
export function OffNote({ react, whole }: { react: ReactData; whole: boolean }) {
  const { status } = react;
  const off = status.off;
  if (off && (off.key === 'react' || !whole)) {
    const code = (v: string) => <Cmd>{v}</Cmd>;
    const line =
      off.where === 'env'
        ? tx('diagnostics.react.off.env', { variable: code('PXSIG_REACT=off') })
        : off.where === 'flag'
          ? tx('diagnostics.react.off.flag', { flag: code('pxsig serve --no-react') })
          : off.key === 'react'
            ? tx(
                off.where === 'workspace'
                  ? 'diagnostics.react.off.workspace'
                  : 'diagnostics.react.off.config',
                {
                  setting: code(
                    off.where === 'workspace' ? '"defaults": { "react": false }' : '"react": false'
                  ),
                }
              )
            : tx(
                off.where === 'workspace'
                  ? 'diagnostics.react.off.compilerWorkspace'
                  : 'diagnostics.react.off.compilerConfig',
                { setting: code('"react": { "compiler": false }') }
              );
    return (
      <p className={s.lede}>
        {line} <HelpLine k="diagnostics.react.off.help" />
      </p>
    );
  }
  if (whole) return null;
  if (status.compiler === 'not-installed')
    return (
      <p className={s.lede}>
        {t('diagnostics.react.notInstalled', { missing: status.missing.join(', ') })}{' '}
        <HelpLine k="diagnostics.react.notInstalledHelp" />
      </p>
    );
  if (status.compiler === 'bad-config')
    return (
      <p className={s.lede}>
        {t('diagnostics.react.badConfig', { warning: status.configWarning ?? '' })}
      </p>
    );
  return null;
}

/** A run that failed, or results that could not be saved: a message about the tab. */
export function RunNotes({ react, failed }: { react: ReactData; failed: string | null }) {
  return (
    <>
      {failed != null ? (
        <Alert tone="neutral" label={t('diagnostics.react.compiler.failedTitle')}>
          <AlertTitle>{t('diagnostics.react.compiler.failedTitle')}</AlertTitle>
          <AlertDescription>
            {t('diagnostics.react.compiler.failed', { error: failed })}
          </AlertDescription>
        </Alert>
      ) : null}
      {react.status.held ? (
        <Alert
          tone="neutral"
          label={t('diagnostics.react.compiler.held', { holder: react.status.held })}
        >
          <AlertDescription>
            {t('diagnostics.react.compiler.held', { holder: react.status.held })}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

/** Whether this page offers runs at all: served by pxsig, not a static report. */
export const offersRuns = (data: Data) => served && !data.static;

/** A disabled run's title: why it is disabled. */
export const readOnlyTitle = () => t('diagnostics.react.readOnlyTitle');

/** A function's file, from its id (`path#name`). */
export const pathOf = (f: ReactFunction) => f.id.slice(0, f.id.lastIndexOf('#'));

/** The rule the change is about (the new stopping rule first), the others, and its line. */
export function rulesOf(f: ReactFunction) {
  const head = f.head?.diagnostics ?? [];
  const base = new Set((f.base?.diagnostics ?? []).map((d) => d.rule || d.category));
  const name = (d: { rule: string; category: string }) => d.rule || d.category;
  const first =
    head.find((d) => d.stops && !base.has(name(d))) ??
    head.find((d) => !base.has(name(d))) ??
    head[0];
  return {
    rule: first ? name(first) : '',
    line: first?.line ?? null,
    others: head.filter((d) => d !== first).map(name),
  };
}

const numbers = new Intl.NumberFormat(locale);
/** A count as the copy formats numbers ("1,046"); "—" when unknown. */
export const num = (n: number | null | undefined) => (n == null ? '—' : numbers.format(n));
