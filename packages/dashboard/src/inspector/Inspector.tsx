import React from 'react';
import {
  Button,
  CopyValue,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Kbd,
  Link,
  Progress,
  Slider,
  StaticList,
  StaticListItem,
  StatusBadge,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  Toolbar,
  ToolbarLeft,
  ToolbarRight,
  Badge,
} from '@hydrotik/design-system';
import { type Data, type Queue, type Row, fmt, pathsFor, reviewAction, served, statusOf } from '../data';
import { analyse, cellsLayer, hex, loadImg, readPixels, type Analysis } from './analyse';
import { Stage, type Hover, type Mode, type StageApi } from './Stage';
import { StatusOf } from '../parts/StatusOf';
import { Cmd, t, tx } from '../copy';
import * as s from '../dashboard.css';

export interface InspectTarget {
  row: Row;
  /** Scenario renders: { tag, name }; null for the latest check. */
  scenario: { tag: string; name: string } | null;
  /** The list being browsed (←/→). */
  list: Row[];
  /** A review session over a queue: shows progress, then a summary when every entry is decided. */
  session?: Queue;
}

const MODES: Mode[] = ['side', 'swipe', 'onion', 'diff', 'heat'];

const PREFS_KEY = 'pxsig-inspector';
const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
};

interface Loaded {
  a: HTMLImageElement;
  b: HTMLImageElement;
  heat: HTMLImageElement | null;
  pa: ImageData | null;
  pb: ImageData | null;
  cells: HTMLCanvasElement | null;
}

export function Inspector({
  data,
  target,
  onNavigate,
  onClose,
  onGo,
  embedded = false,
}: {
  data: Data;
  target: InspectTarget | null;
  onNavigate(t: InspectTarget): void;
  onClose(): void;
  /** Leave the inspector for a tab (and filter): the session summary's next steps. */
  onGo?(tab: string, filter?: string): void;
  embedded?: boolean;
}) {
  const prefs = React.useMemo(loadPrefs, []);
  const [mode, setMode] = React.useState<Mode>(prefs.mode ?? 'side');
  const [split, setSplit] = React.useState<number>(prefs.split ?? 50);
  const [onion, setOnion] = React.useState<number>(prefs.onion ?? 50);
  const [heat, setHeat] = React.useState<number>(prefs.heat ?? 60);
  const [tol, setTol] = React.useState<number>(prefs.tol ?? 16);
  const [showBoxes, setShowBoxes] = React.useState<boolean>(prefs.boxes ?? true);
  const [showHighlight, setShowHighlight] = React.useState<boolean>(prefs.highlight ?? true);
  const [showTiles, setShowTiles] = React.useState<boolean>(prefs.tiles ?? true);
  React.useEffect(() => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          mode,
          split,
          onion,
          heat,
          tol,
          boxes: showBoxes,
          highlight: showHighlight,
          tiles: showTiles,
        })
      );
    } catch {
      /* per-viewer convenience only */
    }
  }, [mode, split, onion, heat, tol, showBoxes, showHighlight, showTiles]);

  const [loaded, setLoaded] = React.useState<Loaded | null | 'missing'>(null);
  const [zoom, setZoom] = React.useState(1);
  const [hover, setHover] = React.useState<Hover | null>(null);
  const [region, setRegion] = React.useState(-1);
  const [busy, setBusy] = React.useState(false);
  // Embedded in Storybook's short panel the image gets the room; details open on demand.
  const [showSide, setShowSide] = React.useState<boolean>(!embedded);
  const [sizes, setSizes] = React.useState<Record<string, string>>({});
  // Keep browsing after the session summary appears (to undo or look back).
  const [stay, setStay] = React.useState(false);
  const stage = React.useRef<StageApi>(null);

  const row = target?.row ?? null;
  const p = row ? pathsFor(data, row.id, target!.scenario) : null;

  React.useEffect(() => {
    if (!p) return;
    let alive = true;
    setLoaded(null);
    setRegion(-1);
    Promise.all([loadImg(p.before), loadImg(p.after), loadImg(p.heat)]).then(([a, b, h]) => {
      if (!alive) return;
      if (!a || !b) return setLoaded('missing');
      setLoaded({
        a,
        b,
        heat: h,
        pa: readPixels(a),
        pb: readPixels(b),
        cells: h ? cellsLayer(h) : null,
      });
    });
    if (served) {
      const files = [p.before, p.after, p.baseSig, p.curSig, p.heat, p.page, p.record].filter(
        Boolean
      ) as string[];
      Promise.all(
        files.map((f) =>
          fetch(f, { method: 'HEAD' })
            .then(
              (r) =>
                [f, r.ok ? fmt.kb(Number(r.headers.get('content-length'))) : 'missing'] as const
            )
            .catch(() => [f, ''] as const)
        )
      ).then((entries) => alive && setSizes(Object.fromEntries(entries)));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, target?.scenario?.name]);

  const pixels = loaded && loaded !== 'missing' && loaded.pa && loaded.pb ? loaded : null;
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  React.useEffect(() => {
    if (!pixels) return setAnalysis(null);
    const t = setTimeout(
      () => setAnalysis(analyse(pixels.pa!, pixels.pb!, tol)),
      analysis ? 120 : 0
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixels, tol]);

  // Fit on open, then land on the biggest change of a failing story.
  const fittedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!loaded || loaded === 'missing' || !row) return;
    const key = `${row.id}|${target?.scenario?.name ?? ''}`;
    if (fittedFor.current === key || (pixels && !analysis)) return;
    fittedFor.current = key;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      stage.current?.fit();
      if (analysis?.regions.length && !row.pass) {
        setRegion(0);
        stage.current?.focus(analysis.regions[0]);
      }
    }));
  }, [loaded, analysis, row, pixels, target?.scenario?.name]);

  const regions = analysis?.regions ?? [];
  const focusRegion = (i: number) => {
    const r = regions[i];
    if (!r) return;
    setRegion(i);
    stage.current?.focus(r);
  };
  const stepRegion = (d: number) =>
    regions.length &&
    focusRegion(
      region < 0 ? (d > 0 ? 0 : regions.length - 1) : (region + d + regions.length) % regions.length
    );

  const list = target?.list ?? [];
  const index = row ? list.findIndex((r) => r.id === row.id) : -1;
  const step = (d: number) => {
    if (!target || list.length < 2) return;
    let i = index;
    do i = (i + d + list.length) % list.length;
    while (!list[i].metrics && !(list[i].new && !list[i].pending) && i !== index);
    onNavigate({ ...target, row: list[i] });
  };

  const canReview = served && !target?.scenario;
  const review = row ? data.review[row.id] : undefined;
  const act = async (action: 'approve' | 'reject' | 'unreview') => {
    if (!row) return;
    setBusy(true);
    try {
      await reviewAction(action, row.id);
      if (action !== 'unreview') {
        // The next undecided entry after this one, wrapping to the start of the list.
        const open = (r: Row) => !r.pass && !data.review[r.id] && r.id !== row.id;
        const next = [...list.slice(index + 1), ...list.slice(0, Math.max(index, 0))].find(open);
        if (next) onNavigate({ ...target!, row: next });
      }
    } catch (e) {
      alert(t('inspector.review.failed', { action: t(`inspector.review.${action === 'unreview' ? 'undo' : action}`), error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  // Other modes / states of the same story: switch between them in place.
  const siblings =
    row && !target?.scenario
      ? (data.check?.rows ?? []).filter((r) => r.story === row.story && !r.skipped)
      : [];

  // The summary screen takes no shortcuts (A would re-approve the last entry).
  const blockKeys = React.useRef(false);
  const onKey = (e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'key' | 'target' | 'preventDefault'>) => {
    if (blockKeys.current || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('[role="slider"]') && e.key.startsWith('Arrow')) return;
    const k = e.key;
    const run = (f: () => void) => (e.preventDefault(), f());
    if (k >= '1' && k <= '5') return run(() => setMode(MODES[Number(k) - 1]));
    if (k === 'f' || k === 'F') return run(() => stage.current?.fit());
    if (k === '0') return run(() => stage.current?.zoomTo(1));
    if (k === '+' || k === '=') return run(() => stage.current?.zoomBy(1.5));
    if (k === '-' || k === '_') return run(() => stage.current?.zoomBy(1 / 1.5));
    if (k === 'n') return run(() => stepRegion(1));
    if (k === 'N') return run(() => stepRegion(-1));
    if (k === 'ArrowRight' || k === 'j') return run(() => step(1));
    if (k === 'ArrowLeft' || k === 'k') return run(() => step(-1));
    if ((k === 'a' || k === 'A') && canReview && !busy) return run(() => act('approve'));
    if ((k === 'r' || k === 'R') && canReview && !busy) return run(() => act('reject'));
  };
  // In the dialog the shortcuts listen on the window: a button that disappears after a click
  // (Undo, Approve) drops focus to the page, and a listener on the inspector would miss them.
  const keyRef = React.useRef(onKey);
  keyRef.current = onKey;
  React.useEffect(() => {
    if (embedded) return;
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      keyRef.current(e);
    };
    // Capture phase: controls inside the dialog stop some keys from bubbling.
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [embedded]);

  if (!row || !p) return null;
  const m = row.metrics;
  const detail = row.detail;
  const W =
    loaded && loaded !== 'missing' ? Math.max(loaded.a.naturalWidth, loaded.b.naturalWidth) : 0;
  const H =
    loaded && loaded !== 'missing' ? Math.max(loaded.a.naturalHeight, loaded.b.naturalHeight) : 0;
  const sizeNote =
    loaded &&
    loaded !== 'missing' &&
    (loaded.a.naturalWidth !== loaded.b.naturalWidth ||
      loaded.a.naturalHeight !== loaded.b.naturalHeight)
      ? `${loaded.a.naturalWidth}×${loaded.a.naturalHeight} → ${loaded.b.naturalWidth}×${loaded.b.naturalHeight}`
      : `${W}×${H}`;
  // A served URL (/p/<project>/renders/…) or a static one (./renders/…) → the file in the store.
  const repoPath = (u: string) => `${data.store ?? '.pxsig'}/${u.replace(/^\/p\/[^/]+\//, '').replace(/^\.\//, '')}`;
  const sb = `${data.storybook.baseUrl}/?path=/story/${row.story ?? row.id}`;
  const cw = W / (m?.grid ?? 64);
  const chh = H / (m?.grid ?? 64);
  const dmax =
    hover?.before && hover.after
      ? Math.max(...hover.before.map((v, i) => Math.abs(v - hover.after![i])))
      : 255;

  const viewControls = (
    <>
      {mode === 'swipe' ? (
        <Slider
          className={s.sliderCtl}
          label={t('inspector.sliders.swipe')}
          showValue
          formatValue={([v]) => `${v}%`}
          value={[split]}
          max={100}
          onValueChange={([v]) => setSplit(v)}
        />
      ) : null}
      {mode === 'onion' ? (
        <Slider
          className={s.sliderCtl}
          label={t('inspector.sliders.opacity')}
          showValue
          formatValue={([v]) => `${v}%`}
          value={[onion]}
          max={100}
          onValueChange={([v]) => setOnion(v)}
        />
      ) : null}
      {mode === 'heat' ? (
        <Slider
          className={s.sliderCtl}
          label={t('inspector.sliders.cells')}
          showValue
          formatValue={([v]) => `${v}%`}
          value={[heat]}
          max={100}
          onValueChange={([v]) => setHeat(v)}
        />
      ) : null}
      {pixels ? (
        <Slider
          className={s.sliderCtl}
          label={t('inspector.sliders.tolerance')}
          showValue
          value={[tol]}
          max={96}
          onValueChange={([v]) => setTol(v)}
        />
      ) : null}
      {pixels && mode === 'side' ? (
        <label className={s.ctl}>
          <Switch
            checked={showHighlight}
            onCheckedChange={setShowHighlight}
            aria-label={t('inspector.toggles.highlightLabel')}
          />{' '}
          {t('inspector.toggles.highlight')}
        </label>
      ) : null}
      {pixels ? (
        <label className={s.ctl}>
          <Switch
            checked={showBoxes}
            onCheckedChange={setShowBoxes}
            aria-label={t('inspector.toggles.regionsLabel')}
          />{' '}
          {t('inspector.toggles.regions')}
        </label>
      ) : null}
      {detail?.tripped?.length ? (
        <label className={s.ctl}>
          <Switch
            checked={showTiles}
            onCheckedChange={setShowTiles}
            aria-label={t('inspector.toggles.tilesLabel')}
          />{' '}
          {t('inspector.toggles.tiles')}
        </label>
      ) : null}
    </>
  );
  const siblingToggle =
    siblings.length > 1 ? (
      <ToggleGroup
        type="single"
        value={row.id}
        onValueChange={(v) =>
          v && onNavigate({ ...target!, row: siblings.find((r) => r.id === v)! })
        }
        aria-label={t('inspector.variant')}
      >
        {siblings.map((r) => (
          <ToggleGroupItem
            key={r.id}
            value={r.id}
            aria-label={`${r.mode}${r.state ? ` ${r.state}` : ''}`}
          >
            {r.mode}
            {r.state ? `·${r.state}` : ''}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    ) : null;
  const storyNav =
    list.length > 1 ? (
      <span className={s.row}>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={t('inspector.nav.prevStory')}
          title={t('inspector.nav.prevStory')}
          onClick={() => step(-1)}
        >
          ‹
        </Button>
        <span className={s.micro}>
          {t('inspector.nav.position', { index: index + 1, total: list.length })}
        </span>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={t('inspector.nav.nextStory')}
          title={t('inspector.nav.nextStory')}
          onClick={() => step(1)}
        >
          ›
        </Button>
      </span>
    ) : null;
  const reviewButtons =
    canReview && (row.changed || review) ? (
      <>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || review?.state === 'rejected'}
          onClick={() => act('reject')}
          title={t('inspector.review.rejectTitle')}
        >
          {t('inspector.review.reject')}
        </Button>
        <Button
          size="sm"
          disabled={busy || review?.state === 'approved' || (row.pass && !row.changed)}
          onClick={() => act('approve')}
          title={t('inspector.review.approveTitle')}
        >
          {t('inspector.review.approve')}
        </Button>
        {review ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('unreview')} title={review.state === 'approved' ? t('inspector.review.undoTitle') : undefined}>
            {t('inspector.review.undo')}
          </Button>
        ) : null}
      </>
    ) : null;
  // Embedded (Storybook panel) there is no Dialog around the body, so no Dialog parts.
  const Title = embedded ? 'h3' : DialogTitle;
  const Desc = embedded ? 'p' : DialogDescription;

  // --- review session: progress while deciding, then a summary with the next steps ---------------
  const session = embedded ? null : (target?.session ?? null);
  const decided = session ? list.filter((r) => data.review[r.id]).length : 0;
  const approvedRows = session ? list.filter((r) => data.review[r.id]?.state === 'approved') : [];
  const rejectedRows = session ? list.filter((r) => data.review[r.id]?.state === 'rejected') : [];
  const complete = !!session && list.length > 0 && decided === list.length && !stay;
  blockKeys.current = complete;
  const progress = session ? (
    <div className={s.sessionBar}>
      <strong>{t(`inspector.session.${session}`)}</strong>
      <Progress className={s.grow} value={Math.round((decided / (list.length || 1)) * 100)} aria-label={t('inspector.session.label')} />
      <span className={s.micro}>{t('inspector.session.progress', { done: decided, total: list.length, left: list.length - decided })}</span>
    </div>
  ) : null;
  const rejectedNote =
    review?.state === 'rejected' && !target?.scenario ? (
      <div className={s.note}>
        <span>{t('inspector.rejectedNote')}</span>
        <CopyValue value={`pxsig check ${row.id}`} />
      </div>
    ) : null;
  if (complete)
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className={s.summaryDialog} showCloseButton={false} aria-describedby={undefined}>
          {progress}
          <div className={s.summary}>
            <DialogTitle className={s.insTitle}>{t('inspector.session.complete')}</DialogTitle>
            <StaticList labelWidth="30%">
              <StaticListItem label={t('inspector.session.approved', { count: approvedRows.length })}>
                {tx('inspector.session.approvedNext', { store: <Cmd>{data.store ?? '.pxsig'}</Cmd> })}
              </StaticListItem>
              {rejectedRows.length ? (
                <StaticListItem label={t('inspector.session.rejected', { count: rejectedRows.length })}>
                  <span className={s.stack}>
                    <span>{t('inspector.session.rejectedNext')}</span>
                    <CopyValue value={`pxsig check ${rejectedRows.map((r) => r.id).join(' ')}`} />
                  </span>
                </StaticListItem>
              ) : null}
            </StaticList>
            <span className={s.row}>
              <Button size="sm" onClick={() => (onGo ? onGo('overview') : onClose())}>
                {t('inspector.session.back')}
              </Button>
              {rejectedRows.length && onGo ? (
                <Button size="sm" variant="outline" onClick={() => onGo('stories', 'rejected')}>
                  {t('inspector.session.viewRejected')}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setStay(true)}>
                {t('inspector.session.backToEntries')}
              </Button>
            </span>
          </div>
        </DialogContent>
      </Dialog>
    );

  const body = (
    <div onKeyDown={embedded ? (e) => onKey(e.nativeEvent) : undefined} style={{ display: 'contents' }}>
      {progress}
      {embedded ? null : (
        <div className={s.insHead}>
          <div style={{ minInlineSize: 0 }}>
            <div className={s.micro}>
              {target!.scenario
                ? t('inspector.contextScenario', { name: target!.scenario.name })
                : `${t('inspector.contextLatest', { mode: row.mode })}${row.state ? ` · ${row.state}` : ''}${row.browser && row.browser !== 'chromium' ? ` · ${row.browser}` : ''}`}
            </div>
            <Title className={s.insTitle}>{row.id}</Title>
            <Desc className={s.micro} style={{ margin: 0 }}>
              {row.reasons?.length
                ? row.reasons.join(' · ')
                : row.pass
                  ? t('inspector.withinGate')
                  : (row.error ?? '')}
            </Desc>
          </div>
          <div className={s.row}>
            <StatusOf status={statusOf(row, data.review)} />
            {siblingToggle}
            {storyNav}
            {reviewButtons}
            {embedded ? null : (
              <Button size="sm" variant="outline" onClick={onClose}>
                {t('inspector.close')}
              </Button>
            )}
          </div>
        </div>
      )}

      {rejectedNote}
      <Toolbar className={s.insToolbar}>
        <ToolbarLeft>
          {embedded ? <StatusOf status={statusOf(row, data.review)} /> : null}
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as Mode)}
            aria-label={t('inspector.modes.label')}
          >
            {MODES.map((k, i) => (
              <ToggleGroupItem key={k} value={k} title={`${t(`inspector.modes.${k}`)} (${i + 1})`} aria-label={t(`inspector.modes.${k}`)}>
                {embedded ? t(`inspector.modes.${k}Short`) : t(`inspector.modes.${k}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className={s.row}>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t('inspector.zoomOut')}
              onClick={() => stage.current?.zoomBy(1 / 1.5)}
            >
              −
            </Button>
            <span
              className={s.mono}
              style={{ minInlineSize: '3.5rem', textAlign: 'center', fontSize: '0.75rem' }}
              aria-live="polite"
            >
              {Math.round(zoom * 100)}%
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t('inspector.zoomIn')}
              onClick={() => stage.current?.zoomBy(1.5)}
            >
              +
            </Button>
            <Button
              size="sm"
              variant="outline"
              title={t('inspector.fitTitle')}
              onClick={() => stage.current?.fit()}
            >
              {t('inspector.fit')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              title={t('inspector.actualTitle')}
              onClick={() => stage.current?.zoomTo(1)}
            >
              {t('inspector.actual')}
            </Button>
          </span>
          {embedded ? null : viewControls}
        </ToolbarLeft>
        <ToolbarRight>
          {embedded ? siblingToggle : null}
          {embedded ? reviewButtons : null}
          {embedded ? (
            <label className={s.ctl}>
              <Switch checked={showSide} onCheckedChange={setShowSide} aria-label={t('inspector.toggles.detailsLabel')} />{' '}
              {t('inspector.toggles.details')}
            </label>
          ) : null}
          {pixels && !embedded ? (
            <span className={s.row}>
              <Button
                size="icon-sm"
                variant="outline"
                disabled={!regions.length}
                aria-label={t('inspector.nav.prevChange')}
                onClick={() => stepRegion(-1)}
              >
                ‹
              </Button>
              <span className={s.micro}>
                {regions.length
                  ? t('inspector.nav.change', { index: region < 0 ? '–' : region + 1, total: regions.length })
                  : t('inspector.nav.noChanges')}
              </span>
              <Button
                size="icon-sm"
                variant="outline"
                disabled={!regions.length}
                aria-label={t('inspector.nav.nextChange')}
                onClick={() => stepRegion(1)}
              >
                ›
              </Button>
            </span>
          ) : null}
        </ToolbarRight>
      </Toolbar>

      <div className={s.insMain}>
        <div className={s.insStageWrap}>
          {loaded === 'missing' ? (
            <div className={s.empty}>{t('inspector.missing', { before: p.before, after: p.after })}</div>
          ) : loaded ? (
            <Stage
              ref={stage}
              mode={mode}
              a={loaded.a}
              b={loaded.b}
              pa={loaded.pa}
              pb={loaded.pb}
              analysis={analysis}
              cells={loaded.cells}
              heatImg={loaded.heat}
              tiles={detail?.tripped?.length ? { indices: detail.tripped, tile: 16 } : null}
              labels={[p.beforeLabel, p.afterLabel]}
              split={split}
              onion={onion}
              heat={heat}
              tol={tol}
              showBoxes={showBoxes}
              showHighlight={showHighlight}
              showTiles={showTiles}
              activeRegion={region}
              onSplit={setSplit}
              onZoom={setZoom}
              onHover={setHover}
            />
          ) : (
            <div className={s.empty}>{t('inspector.loading')}</div>
          )}
          {embedded ? null : (
            <div className={s.insHelp}>
              {[
                ['1–5', t('inspector.keys.mode')],
                ['F', t('inspector.keys.fit')],
                ['0', t('inspector.keys.actual')],
                ['+ −', t('inspector.keys.zoom')],
                ['N ⇧N', t('inspector.keys.change')],
                ['← →', t('inspector.keys.story')],
                ...(canReview
                  ? [
                      ['A', t('inspector.keys.approve')],
                      ['R', t('inspector.keys.reject')],
                    ]
                  : []),
                ...(embedded ? [] : [['Esc', t('inspector.keys.close')]]),
              ].map(([k, v]) => (
                <span key={k}>
                  <Kbd size="sm">{k}</Kbd> {v}
                </span>
              ))}
            </div>
          )}
        </div>

        {showSide ? (
          <aside className={s.insSide}>
            {embedded ? (
              <section className={s.sideSection}>
                <h4 className={s.sectionTitle}>{t('inspector.sections.view')}</h4>
                <div className={s.stack}>{viewControls}</div>
                {pixels ? (
                  <span className={s.row}>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      disabled={!regions.length}
                      aria-label={t('inspector.nav.prevChange')}
                      onClick={() => stepRegion(-1)}
                    >
                      ‹
                    </Button>
                    <span className={s.micro}>
                      {regions.length
                        ? t('inspector.nav.change', { index: region < 0 ? '–' : region + 1, total: regions.length })
                        : t('inspector.nav.noChanges')}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      disabled={!regions.length}
                      aria-label={t('inspector.nav.nextChange')}
                      onClick={() => stepRegion(1)}
                    >
                      ›
                    </Button>
                  </span>
                ) : null}
              </section>
            ) : null}
            <section className={s.sideSection}>
              <h4 className={s.sectionTitle}>{t('inspector.sections.pixel')}</h4>
              <div className={s.readout}>
                {!pixels ? (
                  <span className={s.muted}>{tx('inspector.pixel.needsServer', { command: <Cmd>pxsig serve</Cmd> })}</span>
                ) : !hover ? (
                  <span className={s.muted}>{t('inspector.pixel.hover')}</span>
                ) : (
                  <>
                    <div className={s.pxRow}>
                      <span className={s.mono}>{t('inspector.pixel.coords', { x: hover.ix, y: hover.iy })}</span>
                      <span className={`${s.mono} ${s.muted}`}>
                        {t('inspector.pixel.cellTile', { cx: Math.floor(hover.ix / cw), cy: Math.floor(hover.iy / chh), tx: Math.floor(hover.ix / 16), ty: Math.floor(hover.iy / 16) })}
                      </span>
                    </div>
                    {(
                      [
                        [t('inspector.pixel.before'), hover.before],
                        [t('inspector.pixel.after'), hover.after],
                      ] as const
                    ).map(([label, v]) => (
                      <div className={s.pxRow} key={label}>
                        <span
                          className={s.swatch}
                          style={
                            v
                              ? { background: `rgba(${v[0]},${v[1]},${v[2]},${v[3] / 255})` }
                              : undefined
                          }
                        />
                        <span className={s.micro} style={{ minInlineSize: '4rem' }}>
                          {label}
                        </span>
                        <span className={s.mono}>
                          {v
                            ? `${hex(v[0], v[1], v[2])}${v[3] < 255 ? ` α${v[3]}` : ''}`
                            : t('inspector.pixel.outside')}
                        </span>
                      </div>
                    ))}
                    <div className={s.pxRow}>
                      <span className={s.micro}>{t('inspector.pixel.maxDelta')}</span>
                      {dmax > tol ? (
                        <Badge variant="destructive">{dmax}</Badge>
                      ) : (
                        <span className={s.mono}>{dmax}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </section>

            {pixels && analysis ? (
              <section className={s.sideSection}>
                <h4 className={s.sectionTitle}>{t('inspector.sections.changes')}</h4>
                <StaticList labelWidth="45%">
                  <StaticListItem label={t('inspector.changes.pixels')}>
                    <span className={s.mono}>
                      {fmt.num(analysis.changed)} (
                      {((analysis.changed / (W * H || 1)) * 100).toFixed(
                        analysis.changed && analysis.changed / (W * H) < 0.001 ? 3 : 2
                      )}
                      %)
                    </span>
                  </StaticListItem>
                  <StaticListItem label={t('inspector.changes.regions')}>
                    <span className={s.mono}>{regions.length}</span>
                  </StaticListItem>
                  <StaticListItem label={t('inspector.changes.maxDelta')}>
                    <span className={s.mono}>{analysis.maxD}</span>
                  </StaticListItem>
                  <StaticListItem label={t('inspector.changes.size')}>
                    <span className={s.mono}>{sizeNote}</span>
                  </StaticListItem>
                </StaticList>
                <ol className={s.regions}>
                  {regions.length ? (
                    regions.slice(0, 50).map((r, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          className={s.region}
                          aria-pressed={i === region}
                          onClick={() => focusRegion(i)}
                        >
                          <span className={s.mono}>
                            {r.w}×{r.h} @ {r.x},{r.y}
                          </span>
                          <span className={s.muted}>{fmt.num(r.px)} px</span>
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className={s.muted}>
                      {analysis.changed ? '' : t('inspector.changes.noneOver', { tol })}
                    </li>
                  )}
                </ol>
              </section>
            ) : null}

            {m ? (
              <section className={s.sideSection}>
                <h4 className={s.sectionTitle}>{t('inspector.sections.metrics')}</h4>
                <StaticList labelWidth="45%">
                  <StaticListItem label={t('inspector.metrics.ssim')}>
                    <span className={s.mono}>{m.ssim}</span>{' '}
                    {m.ssim < 0.99 ? <Badge variant="destructive">&lt; 0.99</Badge> : null}
                  </StaticListItem>
                  <StaticListItem label={t('inspector.metrics.cellsOver', { threshold: m.threshold })}>
                    <span className={s.mono}>
                      {m.changedCells} ({m.changedCellsPct}%)
                    </span>
                  </StaticListItem>
                  <StaticListItem label={t('inspector.metrics.maxCell')}>
                    <span className={s.mono}>{m.maxCellDiff}</span>
                  </StaticListItem>
                  <StaticListItem label={t('inspector.metrics.edge')}>
                    <span className={s.mono}>{m.edgeDiffPct}%</span>
                  </StaticListItem>
                  {detail ? (
                    <>
                      <StaticListItem label={t('inspector.metrics.tilesChanged')}>
                        <span className={s.mono}>{detail.changedTiles}</span>{' '}
                        {detail.changedTiles + detail.newEdgeTiles >= 3 ? (
                          <Badge variant="destructive">≥ 3</Badge>
                        ) : null}
                      </StaticListItem>
                      <StaticListItem label={t('inspector.metrics.newEdges')}>
                        <span className={s.mono}>{detail.newEdgeTiles}</span>
                      </StaticListItem>
                      <StaticListItem label={t('inspector.metrics.maxBlock')}>
                        <span className={s.mono}>{detail.maxBlockDelta}</span>
                      </StaticListItem>
                    </>
                  ) : null}
                </StaticList>
                <div className={s.sigs}>
                  <figure>
                    <img src={p.baseSig} alt={t('inspector.metrics.baseSig')} />
                    <figcaption className={s.micro}>{t('inspector.metrics.baseSig')}</figcaption>
                  </figure>
                  <figure>
                    <img src={p.curSig} alt={t('inspector.metrics.curSig')} />
                    <figcaption className={s.micro}>{t('inspector.metrics.curSig')}</figcaption>
                  </figure>
                  <figure>
                    <img src={p.heat} alt={t('inspector.metrics.heatmap')} />
                    <figcaption className={s.micro}>{t('inspector.metrics.heatmap')}</figcaption>
                  </figure>
                </div>
              </section>
            ) : null}

            {row.a11y?.violations?.length ? (
              <section className={s.sideSection}>
                <h4 className={s.sectionTitle}>{t('inspector.sections.a11y', { count: row.a11y.violations.length })}</h4>
                <ul className={s.resources}>
                  {row.a11y.violations.map((v) => (
                    <li key={v.id}>
                      <StatusBadge
                        label={v.impact ?? 'n/a'}
                        tone={
                          v.impact === 'critical' || v.impact === 'serious' ? 'error' : 'warning'
                        }
                      />
                      <span className={s.grow} title={v.help}>
                        {v.id} · {t('inspector.a11y.nodes', { count: v.nodes })}
                      </span>
                      {row.a11y?.baseline && !row.a11y.baseline.includes(v.id) ? (
                        <Badge variant="destructive">{t('inspector.a11y.new')}</Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className={s.sideSection}>
              <h4 className={s.sectionTitle}>{t('inspector.sections.files')}</h4>
              <ul className={s.resources}>
                {(
                  [
                    [p.beforeLabel, p.before],
                    [p.afterLabel, p.after],
                    [t('inspector.files.baseSig'), p.baseSig],
                    [t('inspector.files.curSig'), p.curSig],
                    [t('inspector.files.heat'), p.heat],
                    [t('inspector.files.page'), p.page],
                    ...(p.record ? [[t('inspector.files.record'), p.record]] : []),
                  ] as [string, string][]
                ).map(([label, url]) => (
                  <li key={label}>
                    <Link href={url} external className={s.grow}>
                      {label}
                    </Link>
                    <span className={`${s.mono} ${s.muted}`}>{sizes[url] ?? ''}</span>
                    <CopyValue value={repoPath(url)} hideValue label={t('inspector.files.path', { label })} />
                  </li>
                ))}
                <li>
                  <Link href={sb} external className={s.grow}>
                    {t('inspector.files.storybook')}
                  </Link>
                </li>
              </ul>
            </section>
          </aside>
        ) : null}
      </div>
    </div>
  );

  if (embedded) return <div className={s.embed}>{body}</div>;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={s.inspector} showCloseButton={false} aria-describedby={undefined}>
        {body}
      </DialogContent>
    </Dialog>
  );
}
