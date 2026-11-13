/**
 * Report to pxsig (Header.tsx): a gate report for an issue on hydrotik/pxsig, when the gate got
 * this entry wrong. The dialog first re-renders the entry on this machine and says whether it still
 * fails the gate (the self-check), then shows exactly what a copy button copies: the image
 * (baseline | render | diff in one PNG) or the image-free summary, and the text. Options: Full
 * capture, Keep story ID, Image-free. Nothing is copied until a copy button is pressed, and nothing
 * is posted: Open issue opens the issue form in a new tab, the person pastes and posts.
 *
 * The inspector's keys (A approves, R rejects) are off inside the dialog (`data-own-keys`,
 * useInspectorKeys.ts). A read-only page may prepare a report: it decides nothing.
 */
import React from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogDescription,
  DialogTitle,
  Icon,
  IconButton,
  Switch,
} from '@ui';
import {
  type GateReportAnswer,
  type GateReportOptions,
  type Row,
  type SelfCheck,
  gateReport,
  selfCheck,
} from '../data';
import { t } from '../copy';
import * as s from '../dashboard.css';

/** The image copies as one PNG where the browser's clipboard takes images; else it is saved. */
const canCopyImage = () =>
  typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';

/** A PNG data URL as a Blob, decoded here: the page's policy lets no fetch read a data URL. */
const pngBlob = (url: string) => {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
};

/** The header's Report to pxsig button and its dialog. */
export function GateReportButton({ row }: { row: Row }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <IconButton
        size="sm"
        emphasis="ghost"
        label={t('inspector.report.open')}
        title={t('inspector.report.openTitle')}
        onClick={() => setOpen(true)}
      >
        <Icon name="arrow-up-right" size="1em" />
      </IconButton>
      {open ? <GateReportDialog row={row} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function GateReportDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const [check, setCheck] = React.useState<SelfCheck | null>(null);
  const [opts, setOpts] = React.useState<GateReportOptions>({
    full: false,
    keepId: false,
    noImage: false,
  });
  // The report for the options shown (`key`); one for earlier options is not shown.
  const key = `${opts.full}${opts.keepId}${opts.noImage}`;
  const [got, setGot] = React.useState<{
    key: string;
    report?: GateReportAnswer;
    error?: string;
  } | null>(null);
  const [done, setDone] = React.useState<'text' | 'image' | null>(null);
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const [saveOnly, setSaveOnly] = React.useState(!canCopyImage());

  // The self-check first: the report is offered once this machine's re-render has been judged.
  React.useEffect(() => {
    let live = true;
    selfCheck(row.id)
      .then((c) => live && setCheck(c))
      .catch((e: Error) => live && setCheck({ state: 'error', error: e.message }));
    return () => {
      live = false;
    };
  }, [row.id]);
  React.useEffect(() => {
    if (!check) return;
    let live = true;
    gateReport(row.id, opts)
      .then((r) => live && setGot({ key, report: r }))
      .catch((e: Error) => live && setGot({ key, error: e.message }));
    return () => {
      live = false;
    };
  }, [check, row.id, opts, key]);
  const shown = got?.key === key ? got : null;
  const report = shown?.report ?? null;
  const failed = shown?.error ?? null;

  const said = (what: 'text' | 'image') => {
    setCopyError(null);
    setDone(what);
    setTimeout(() => setDone((d) => (d === what ? null : d)), 2000);
  };
  const copyText = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.text);
      said('text');
    } catch (e) {
      setCopyError(t('inspector.report.copyFailed', { error: (e as Error).message }));
    }
  };
  const copyImage = async () => {
    if (!report?.image) return;
    try {
      const blob = pngBlob(report.image);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      said('image');
    } catch (e) {
      setSaveOnly(true);
      setCopyError(t('inspector.report.copyFailed', { error: (e as Error).message }));
    }
  };
  const saveImage = () => {
    if (!report?.image) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(pngBlob(report.image));
    a.download = 'pxsig-gate-report.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const set = (k: keyof GateReportOptions) => (v: boolean) => setOpts((o) => ({ ...o, [k]: v }));
  const option = (k: keyof GateReportOptions, disabled = false) => (
    <label className={s.ctl} data-control>
      <Switch
        checked={opts[k]}
        onCheckedChange={set(k)}
        disabled={disabled || !check}
        label={t(`inspector.report.${k}Label`)}
      />{' '}
      {t(`inspector.report.${k}`)}
    </label>
  );
  const checkLine = !check
    ? t('inspector.report.checking')
    : check.state === 'differs' || check.state === 'passes'
      ? t(`inspector.report.${check.state}`)
      : t(check.state === 'error' ? 'inspector.report.checkError' : 'inspector.report.notChecked', {
          error: check.error ?? '',
        });
  const ready = !!report && !failed;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      className={s.reportDialog}
      initialFocus={titleRef}
    >
      <div className={s.reportBody} data-own-keys>
        <DialogTitle ref={titleRef} tabIndex={-1} className={s.insTitle}>
          {t('inspector.report.title')}
        </DialogTitle>
        <DialogDescription className={`${s.small} ${s.muted}`} style={{ margin: 0 }}>
          {t('inspector.report.description')}
        </DialogDescription>
        <output className={s.small} aria-busy={!check || undefined}>
          {checkLine}
        </output>
        <Alert tone="danger" label={t('inspector.report.publicLabel')}>
          <AlertTitle>{t('inspector.report.publicLabel')}</AlertTitle>
          <AlertDescription>{t('inspector.report.public')}</AlertDescription>
        </Alert>
        <div className={s.row}>
          {option('full', opts.noImage)}
          {option('keepId')}
          {option('noImage')}
        </div>
        {failed ? (
          <p className={s.small} role="alert" style={{ margin: 0 }}>
            {t('inspector.report.failed', { error: failed })}
          </p>
        ) : !check ? null : !report ? (
          <p className={`${s.small} ${s.muted}`} style={{ margin: 0 }}>
            {t('inspector.report.preparing')}
          </p>
        ) : (
          <>
            <h3 className={s.sectionTitle}>{t('inspector.report.imageHeading')}</h3>
            {report.image ? (
              <div className={s.reportImage}>
                <img src={report.image} alt={t('inspector.report.imageAlt')} />
              </div>
            ) : (
              <p className={`${s.small} ${s.muted}`} style={{ margin: 0 }}>
                {t('inspector.report.noImageNote')}
              </p>
            )}
            <h3 className={s.sectionTitle}>{t('inspector.report.textHeading')}</h3>
            <textarea
              className={s.reportText}
              readOnly
              rows={10}
              value={report.text}
              aria-label={t('inspector.report.textHeading')}
            />
            {report.trimmed.length ? (
              <p className={`${s.small} ${s.muted}`} style={{ margin: 0 }}>
                {t('inspector.report.trimmed', { fields: report.trimmed.join(', ') })}
              </p>
            ) : null}
          </>
        )}
        <output className={s.small}>
          {copyError ??
            (done
              ? t(done === 'text' ? 'inspector.report.copiedText' : 'inspector.report.copiedImage')
              : ' ')}
        </output>
        <div className={s.row}>
          <Button size="sm" emphasis="outline" disabled={!ready} onClick={copyText}>
            {t('inspector.report.copyText')}
          </Button>
          {saveOnly ? (
            <Button
              size="sm"
              emphasis="outline"
              disabled={!ready || !report?.image}
              onClick={saveImage}
            >
              {t('inspector.report.saveImage')}
            </Button>
          ) : (
            <Button
              size="sm"
              emphasis="outline"
              disabled={!ready || !report?.image}
              onClick={copyImage}
            >
              {t('inspector.report.copyImage')}
            </Button>
          )}
          {ready ? (
            <Button
              size="sm"
              href={report.url}
              external
              title={t('inspector.report.openIssueTitle')}
            >
              {t('inspector.report.openIssue')}
            </Button>
          ) : (
            <Button size="sm" disabled title={t('inspector.report.openIssueTitle')}>
              {t('inspector.report.openIssue')}
            </Button>
          )}
          <span className={s.spacer} />
          <Button size="sm" emphasis="ghost" onClick={onClose}>
            {t('inspector.report.cancel')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
