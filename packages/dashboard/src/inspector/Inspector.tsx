import React from 'react';
import {
  CopyValue,
  Dialog,
  DialogDescription,
  DialogTitle,
  Progress,
  Switch,
  Toolbar,
  ToolbarEnd,
  ToolbarStart,
} from '@ui';
import {
  type Data,
  type Queue,
  type Row,
  decisionOf,
  fmt,
  pathsFor,
  served,
  statusOf,
} from '../data';
import { analyse, cellsLayer, loadImg, readPixels, type Analysis } from './analyse';
import { Stage } from './Stage';
import { DiffViewer, type DiffViewerActions } from '../diff-viewer';
import { StatusOf } from '../parts/StatusOf';
import { storybookLink } from '../storybook-link.mjs';
import { t } from '../copy';
import * as s from '../dashboard.css';
import { MODES, useInspectorPrefs } from './prefs';
import { useInspectorActions } from './useInspectorActions';
import { useInspectorKeys } from './useInspectorKeys';
import {
  ChangeNav,
  KeyHelp,
  ModeChoice,
  RecheckButton,
  ReviewButtons,
  SiblingToggle,
  StoryNav,
  ViewControls,
  ZoomButtons,
} from './controls';
import { Header } from './Header';
import { useApproving } from '../link';
import { linkCommandLine } from '../parts/Connection';
import { SessionSummary } from './SessionSummary';
import { ViewSection } from './side/ViewSection';
import { PixelSection } from './side/PixelSection';
import { ChangesSection } from './side/ChangesSection';
import { MetricsSection } from './side/MetricsSection';
import { A11ySection } from './side/A11ySection';
import { FilesSection } from './side/FilesSection';

export interface InspectTarget {
  row: Row;
  /** Scenario renders: { tag, name }; null for the latest check. */
  scenario: { tag: string; name: string } | null;
  /** The list being browsed (←/→). */
  list: Row[];
  /** A review session over a queue: shows progress, then a summary when every entry is decided. */
  session?: Queue;
}

export interface Loaded {
  /** Null for a new entry, which has no baseline yet. */
  a: HTMLImageElement | null;
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
  onNavigate: (t: InspectTarget) => void;
  onClose: () => void;
  /** Leave the inspector for a tab (and filter): the session summary's next steps. */
  onGo?: (tab: string, filter?: string) => void;
  embedded?: boolean;
}) {
  const {
    mode,
    setMode,
    split,
    setSplit,
    onion,
    setOnion,
    heat,
    setHeat,
    tol,
    setTol,
    showBoxes,
    setShowBoxes,
    showHighlight,
    setShowHighlight,
    showTiles,
    setShowTiles,
  } = useInspectorPrefs();

  const [loaded, setLoaded] = React.useState<Loaded | null | 'missing'>(null);
  const [region, setRegion] = React.useState(-1);
  const [busy, setBusy] = React.useState(false);
  // Embedded in Storybook's short panel the image gets the room; details open on demand.
  const [showSide, setShowSide] = React.useState<boolean>(!embedded);
  const [sizes, setSizes] = React.useState<Record<string, string>>({});
  // Keep browsing after the session summary appears (to undo or look back).
  const [stay, setStay] = React.useState(false);
  const stage = React.useRef<DiffViewerActions>(null);

  const row = target?.row ?? null;
  const p = row ? pathsFor(data, row.id, target!.scenario) : null;

  React.useEffect(() => {
    if (!p) return;
    let alive = true;
    setLoaded(null);
    setRegion(-1);
    void Promise.all([loadImg(p.before), loadImg(p.after), loadImg(p.heat)]).then(([a, b, h]) => {
      if (!alive) return;
      // A new entry has only its latest render; anything else needs both.
      if (!b || (!a && !row?.new)) return setLoaded('missing');
      setLoaded({
        a,
        b,
        heat: h,
        pa: a ? readPixels(a) : null,
        pb: readPixels(b),
        cells: h ? cellsLayer(h) : null,
      });
    });
    if (served) {
      const files = [p.before, p.after, p.baseSig, p.curSig, p.heat, p.page, p.record].filter(
        Boolean
      ) as string[];
      void Promise.all(
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
  // The entry whose images are drawn, analysed and fitted: until then the stage is aria-busy.
  const [settledFor, setSettledFor] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!loaded || !row) return;
    const key = `${row.id}|${target?.scenario?.name ?? ''}`;
    if (loaded === 'missing') return setSettledFor(key);
    if (fittedFor.current === key || (pixels && !analysis)) return;
    fittedFor.current = key;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        stage.current?.fit();
        if (analysis?.regions.length && !row.pass) {
          setRegion(0);
          stage.current?.focus(analysis.regions[0]);
        }
        setSettledFor(key);
      })
    );
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
  // Known to hold no dashboard link: the buttons stay in place, disabled, and a note says how.
  const approving = useApproving();
  const readOnly = canReview && !embedded && approving?.allowed === false;
  // In an accessibility session the buttons and A / R decide on the entry's violations, not its render.
  const a11yMode = !embedded && target?.session === 'a11y';
  const review = row ? (a11yMode ? data.a11yReview?.[row.id] : data.review[row.id]) : undefined;
  const a11yDecision = row ? data.a11yReview?.[row.id] : undefined;
  const { siblings, storyOpen, note, checking, act, unaccept, recheckOne, approveAll } =
    useInspectorActions({ data, target, row, list, index, a11yMode, onNavigate, setBusy });
  const { blockKeys, onKey } = useInspectorKeys({
    embedded,
    setMode,
    stage,
    stepRegion,
    step,
    canReview,
    busy,
    row,
    act,
  });

  // The dialog opens on its title, not on the first control: a control focused by script before any
  // pointer input shows the keyboard focus ring (a reload with #inspect=… did, on the first mode).
  // Above the early return: a hook after it is skipped on a render without a row, and React fails
  // on the next render that has one (rules of hooks).
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  if (!row || !p) return null;
  const m = row.metrics;
  // The engine writes signature images and the diff page only for entries that fail the gate.
  // Served, the size check says whether they exist; otherwise go by the verdict.
  const hasArtifacts = sizes[p.heat]
    ? sizes[p.heat] !== 'missing'
    : !!target?.scenario || !row.pass;
  const detail = row.detail;
  const W =
    loaded && loaded !== 'missing'
      ? Math.max(loaded.a?.naturalWidth ?? 0, loaded.b.naturalWidth)
      : 0;
  const H =
    loaded && loaded !== 'missing'
      ? Math.max(loaded.a?.naturalHeight ?? 0, loaded.b.naturalHeight)
      : 0;
  const sbLink = storybookLink(data.storybook.baseUrl, row, data.check?.manifest?.modes);
  const sb = sbLink.url;

  const viewControls = (
    <ViewControls
      mode={mode}
      split={split}
      setSplit={setSplit}
      onion={onion}
      setOnion={setOnion}
      heat={heat}
      setHeat={setHeat}
      pixels={pixels}
      tol={tol}
      setTol={setTol}
      showHighlight={showHighlight}
      setShowHighlight={setShowHighlight}
      showBoxes={showBoxes}
      setShowBoxes={setShowBoxes}
      detail={detail}
      showTiles={showTiles}
      setShowTiles={setShowTiles}
    />
  );
  const siblingToggle = (
    <SiblingToggle
      siblings={siblings}
      row={row}
      target={target}
      onNavigate={onNavigate}
      keepHeight={!embedded}
    />
  );
  const storyNav = <StoryNav list={list} index={index} step={step} />;
  const newA11y = row.a11y?.new ?? 0;
  // Rows from older reports may lack `changed`: a failed verdict is a change.
  // A render error has no image of the story: nothing to approve (older reports still
  // mark these changed).
  const changed = !row.error && (row.changed ?? !row.pass);
  // In the dialog the group stays (disabled) on an entry with nothing to decide, so the story
  // arrows beside it do not move between a changed entry and a passing one.
  const idle = a11yMode ? !(newA11y || review) : !(changed || review);
  const reviewButtons = (
    <ReviewButtons
      canReview={canReview}
      idle={idle}
      embedded={embedded}
      a11yMode={a11yMode}
      busy={busy}
      review={review}
      act={act}
      newA11y={newA11y}
      changed={changed}
      row={row}
      a11yDecision={a11yDecision}
      storyOpen={storyOpen}
      target={target}
      approveAll={approveAll}
      readOnly={readOnly}
    />
  );
  const recheckButton = (
    <RecheckButton
      canReview={canReview}
      target={target}
      busy={busy}
      checking={checking}
      recheckOne={recheckOne}
    />
  );
  const readOnlyNote =
    readOnly && approving ? (
      <div className={s.note}>
        <span>{t('inspector.review.readOnly')}</span>
        <CopyValue value={linkCommandLine(approving)} />
        <span>{t('inspector.review.linkTiming')}</span>
      </div>
    ) : null;
  // The read-only note already says what a refused decision's note would.
  const actionNote =
    note && !(readOnly && note === t('inspector.review.needsLink')) ? (
      <div className={s.note} role="status">
        <span>{note}</span>
      </div>
    ) : null;
  const desc = row.reasons?.length
    ? row.reasons.join(' · ')
    : row.pass
      ? t('inspector.withinGate')
      : (row.error ?? '');
  // Embedded (Storybook panel) there is no Dialog around the body, so no Dialog parts. The title is
  // the level below the page's hidden h1, so the outline skips no level.
  const Title = embedded ? 'h2' : DialogTitle;
  const Desc = embedded ? 'p' : DialogDescription;

  // --- review session: progress while deciding, then a summary with the next steps ---------------
  const session = embedded ? null : (target?.session ?? null);
  const decided = session ? list.filter((r) => decisionOf(data, session, r.id)).length : 0;
  const approvedRows = session
    ? list.filter((r) =>
        ['approved', 'accepted'].includes(decisionOf(data, session, r.id)?.state ?? '')
      )
    : [];
  const rejectedRows = session
    ? list.filter((r) => decisionOf(data, session, r.id)?.state === 'rejected')
    : [];
  const complete = !!session && list.length > 0 && decided === list.length && !stay;
  blockKeys.current = complete;
  const progress = session ? (
    <div className={s.sessionBar}>
      <strong>{t(`inspector.session.${session}`)}</strong>
      <Progress
        className={s.grow}
        value={Math.round((decided / (list.length || 1)) * 100)}
        label={t('inspector.session.label')}
      />
      <span className={s.micro}>
        {t('inspector.session.progress', {
          done: decided,
          total: list.length,
          left: list.length - decided,
        })}
      </span>
    </div>
  ) : null;
  const rejectedNote =
    review?.state === 'rejected' && !target?.scenario ? (
      <div className={s.note}>
        <span>{t(a11yMode ? 'inspector.a11yRejectedNote' : 'inspector.rejectedNote')}</span>
        <CopyValue value={`pxsig check ${row.id}`} />
      </div>
    ) : null;
  if (complete)
    return (
      <SessionSummary
        progress={progress}
        data={data}
        a11yMode={a11yMode}
        approvedRows={approvedRows}
        rejectedRows={rejectedRows}
        onClose={onClose}
        onGo={onGo}
        setStay={setStay}
      />
    );

  const stageImages = loaded && loaded !== 'missing' ? loaded : null;
  const body = (
    <div
      onKeyDown={embedded ? (e) => onKey(e.nativeEvent) : undefined}
      style={{ display: 'contents' }}
    >
      <DiffViewer.Root
        baseline={stageImages?.a ?? null}
        latest={stageImages?.b ?? null}
        baselineData={stageImages?.pa ?? null}
        latestData={stageImages?.pb ?? null}
        modes={MODES}
        mode={mode}
        onModeChange={setMode}
        split={split}
        onSplitChange={setSplit}
        activeRegion={region}
        onActiveRegionChange={setRegion}
        actionsRef={stage}
      >
        {progress}
        {embedded ? null : (
          <Header
            data={data}
            row={row}
            target={target}
            embedded={embedded}
            sbLink={sbLink}
            desc={desc}
            Title={Title}
            Desc={Desc}
            titleRef={titleRef}
            siblingToggle={siblingToggle}
            storyNav={storyNav}
            reviewButtons={reviewButtons}
            recheckButton={recheckButton}
            onClose={onClose}
          />
        )}

        {readOnlyNote}
        {rejectedNote}
        {actionNote}
        <Toolbar size="sm" className={s.insToolbar}>
          <ToolbarStart>
            {embedded ? <StatusOf status={statusOf(row, data.review)} /> : null}
            {/* The diff viewer's mode group and zoom controls, rendered with the contract's components. */}
            <DiffViewer.ModeGroup
              label={t('inspector.modes.label')}
              render={(_, g) => <ModeChoice g={g} embedded={embedded} />}
            />
            <DiffViewer.ZoomControls render={(_, z) => <ZoomButtons z={z} />} />
            {embedded ? null : viewControls}
          </ToolbarStart>
          <ToolbarEnd>
            {embedded ? (
              <label className={s.ctl}>
                <Switch
                  checked={showSide}
                  onCheckedChange={setShowSide}
                  label={t('inspector.toggles.detailsLabel')}
                />{' '}
                {t('inspector.toggles.details')}
              </label>
            ) : null}
            {embedded ? siblingToggle : null}
            {/* Last: Approve at the right edge (controls.tsx ReviewButtons). */}
            {embedded ? reviewButtons : null}
            {pixels && !embedded ? (
              <ChangeNav regions={regions} region={region} stepRegion={stepRegion} />
            ) : null}
          </ToolbarEnd>
        </Toolbar>

        <div className={s.insMain}>
          <div
            className={s.insStageWrap}
            aria-busy={settledFor !== `${row.id}|${target?.scenario?.name ?? ''}` || undefined}
          >
            {loaded === 'missing' ? (
              <div className={s.empty}>
                {t('inspector.missing', { before: p.before, after: p.after })}
              </div>
            ) : loaded ? (
              <Stage
                analysis={analysis}
                cells={loaded.cells}
                heatImg={loaded.heat}
                tiles={detail?.tripped?.length ? { indices: detail.tripped, tile: 16 } : null}
                labels={[
                  p.beforeLabel,
                  loaded.a ? p.afterLabel : t('inspector.renders.firstRender'),
                ]}
                onion={onion}
                heat={heat}
                tol={tol}
                showBoxes={showBoxes}
                showHighlight={showHighlight}
                showTiles={showTiles}
              />
            ) : (
              <div className={s.empty}>{t('inspector.loading')}</div>
            )}
            {embedded ? null : (
              <KeyHelp canReview={canReview} a11yMode={a11yMode} embedded={embedded} />
            )}
          </div>

          {showSide ? (
            <aside className={s.insSide}>
              {embedded ? (
                <ViewSection
                  viewControls={viewControls}
                  pixels={pixels}
                  regions={regions}
                  region={region}
                  stepRegion={stepRegion}
                />
              ) : null}
              <PixelSection
                embedded={embedded}
                sb={sb}
                sbLink={sbLink}
                loaded={loaded}
                pixels={pixels}
                W={W}
                H={H}
                m={m}
                tol={tol}
              />

              {pixels && analysis ? (
                <ChangesSection
                  analysis={analysis}
                  loaded={loaded}
                  W={W}
                  H={H}
                  regions={regions}
                  region={region}
                  focusRegion={focusRegion}
                  tol={tol}
                />
              ) : null}

              {m ? (
                <MetricsSection m={m} detail={detail} hasArtifacts={hasArtifacts} p={p} />
              ) : null}

              <A11ySection
                row={row}
                newA11y={newA11y}
                target={target}
                canReview={canReview}
                busy={busy}
                unaccept={unaccept}
                a11yMode={a11yMode}
                a11yDecision={a11yDecision}
                act={act}
              />

              <FilesSection data={data} p={p} hasArtifacts={hasArtifacts} sizes={sizes} sb={sb} />
            </aside>
          ) : null}
        </div>
      </DiffViewer.Root>
    </div>
  );

  if (embedded) return <div className={s.embed}>{body}</div>;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      className={s.inspector}
      initialFocus={titleRef}
    >
      {body}
    </Dialog>
  );
}
