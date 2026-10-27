import React from 'react';
import {
  Badge,
  Button,
  CopyValue,
  Dialog,
  DialogDescription,
  DialogTitle,
  Icon,
  IconButton,
  Kbd,
  KeyValueItem,
  KeyValueList,
  Link,
  Progress,
  SegmentedChoice,
  Slider,
  StatusBadge,
  Switch,
  Toolbar,
  ToolbarEnd,
  ToolbarStart,
} from '@ui';
import { type Data, type Queue, type Row, a11yAction, approveStory, decisionOf, fmt, pathsFor, recheck, reviewAction, served, statusOf, useCheckActivity } from '../data';
import { analyse, cellsLayer, hex, loadImg, readPixels, type Analysis } from './analyse';
import { Stage, type Mode, type Probe } from './Stage';
import { DiffViewer, type DiffViewerActions } from '../diff-viewer';
import { StatusOf } from '../parts/StatusOf';
import { storybookLink } from '../storybook-link.mjs';
import { Cmd, t, tx } from '../copy';
import * as s from '../dashboard.css';
import { NeedsLinkError } from '../link';

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
  /** Null for a new entry, which has no baseline yet. */
  a: HTMLImageElement | null;
  b: HTMLImageElement;
  heat: HTMLImageElement | null;
  pa: ImageData | null;
  pb: ImageData | null;
  cells: HTMLCanvasElement | null;
}

/** Copies a file's path in the repository; says so for a moment after. */
function CopyPath({ value, label }: { value: string; label: string }) {
  const [done, setDone] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard refused: the path is in the title */
    }
  };
  return (
    <Button size="sm" emphasis="ghost" title={value} aria-label={t(done ? 'inspector.files.pathCopied' : 'inspector.files.path', { label })} onClick={copy}>
      {done ? t('inspector.files.copied') : t('inspector.files.copyPath')}
    </Button>
  );
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
    Promise.all([loadImg(p.before), loadImg(p.after), loadImg(p.heat)]).then(([a, b, h]) => {
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
  // In an accessibility session the buttons and A / R decide on the entry's violations, not its render.
  const a11yMode = !embedded && target?.session === 'a11y';
  const review = row ? (a11yMode ? data.a11yReview?.[row.id] : data.review[row.id]) : undefined;
  const a11yDecision = row ? data.a11yReview?.[row.id] : undefined;
  const label = (action: 'approve' | 'reject' | 'unreview', a11y: boolean) => t(`inspector.review.${action === 'unreview' ? 'undo' : a11y && action === 'approve' ? 'accept' : action}`);
  // A decision the server refused: without the dashboard link, the line under the header says how
  // to get it; anything else is an alert, as before.
  const refused = (e: unknown, action: string) => (e instanceof NeedsLinkError ? setNote(t('inspector.review.needsLink')) : alert(t('inspector.review.failed', { action, error: (e as Error).message })));
  const act = async (action: 'approve' | 'reject' | 'unreview', a11y = a11yMode) => {
    if (!row) return;
    setBusy(true);
    try {
      await (a11y ? a11yAction(action === 'approve' ? 'accept' : action, row.id) : reviewAction(action, row.id));
      if (action !== 'unreview' && a11y === a11yMode) {
        // The next undecided entry after this one, wrapping to the start of the list.
        const open = (r: Row) => (a11yMode ? !data.a11yReview?.[r.id] : !r.pass && !data.review[r.id]) && r.id !== row.id;
        const next = [...list.slice(index + 1), ...list.slice(0, Math.max(index, 0))].find(open);
        if (next) onNavigate({ ...target!, row: next });
      }
    } catch (e) {
      refused(e, label(action, a11y));
    } finally {
      setBusy(false);
    }
  };

  // Take one rule off this entry's accepted list: it is reported as new and can be accepted again.
  const unaccept = async (rule: string) => {
    if (!row) return;
    setBusy(true);
    try {
      await a11yAction('unaccept', row.id, rule);
    } catch (e) {
      refused(e, t('inspector.a11y.unaccept'));
    } finally {
      setBusy(false);
    }
  };

  // Other modes / states of the same story: switch between them in place.
  const siblings =
    row && !target?.scenario
      ? (data.check?.rows ?? []).filter((r) => r.story === row.story && !r.skipped)
      : [];

  // Entries of this story waiting for a decision (every mode and state): one click approves them.
  const storyOpen = siblings.filter((r) => ['changed', 'new'].includes(statusOf(r, data.review)) && !r.error);
  // What the last re-check or story approval did, shown under the header until the entry changes.
  const [note, setNote] = React.useState<string | null>(null);
  React.useEffect(() => setNote(null), [row?.id]);
  const activity = useCheckActivity();
  const checking = !!row && !!activity.running?.includes(row.id);
  const recheckOne = async () => {
    if (!row) return;
    setBusy(true);
    try {
      const r = await recheck([row.id]);
      setNote([t('app.check.queued', { count: r.queued.length }), r.skipped?.length ? t('app.check.skipped', { list: r.skipped.map((x) => `${x.name}: ${x.why}`).join('; ') }) : null].filter(Boolean).join(' · '));
    } catch (e) {
      alert(t('inspector.review.failed', { action: t('inspector.review.recheck'), error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };
  const approveAll = async () => {
    if (!row) return;
    setBusy(true);
    try {
      const r = await approveStory(row.story);
      const left = r.skipped.filter((x) => storyOpen.some((o) => o.id === x.id));
      setNote([t('inspector.review.approveStoryDone', { count: r.approved.length, story: row.story }), left.length ? t('inspector.review.approveStoryLeft', { list: left.map((x) => `${x.id}: ${x.why}`).join('; ') }) : null].filter(Boolean).join(' · '));
      // On to the next undecided entry of another story.
      const open = (x: Row) => !x.pass && !data.review[x.id] && x.story !== row.story;
      const next = [...list.slice(index + 1), ...list.slice(0, Math.max(index, 0))].find(open);
      if (next && target) onNavigate({ ...target, row: next });
    } catch (e) {
      refused(e, t('inspector.review.approveStory', { count: storyOpen.length }));
    } finally {
      setBusy(false);
    }
  };

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
    if ((k === 'a' || k === 'A') && canReview && !busy && !row?.error) return run(() => act('approve'));
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

  // The dialog opens on its title, not on the first control: a control focused by script before any
  // pointer input shows the keyboard focus ring (a reload with #inspect=… did, on the first mode).
  // Above the early return: a hook after it is skipped on a render without a row, and React fails
  // on the next render that has one (rules of hooks).
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  if (!row || !p) return null;
  const m = row.metrics;
  // The engine writes signature images and the diff page only for entries that fail the gate.
  // Served, the size check says whether they exist; otherwise go by the verdict.
  const hasArtifacts = sizes[p.heat] ? sizes[p.heat] !== 'missing' : !!target?.scenario || !row.pass;
  const detail = row.detail;
  const W =
    loaded && loaded !== 'missing' ? Math.max(loaded.a?.naturalWidth ?? 0, loaded.b.naturalWidth) : 0;
  const H =
    loaded && loaded !== 'missing' ? Math.max(loaded.a?.naturalHeight ?? 0, loaded.b.naturalHeight) : 0;
  const sizeNote =
    loaded &&
    loaded !== 'missing' &&
    loaded.a &&
    (loaded.a.naturalWidth !== loaded.b.naturalWidth ||
      loaded.a.naturalHeight !== loaded.b.naturalHeight)
      ? `${loaded.a.naturalWidth}×${loaded.a.naturalHeight} → ${loaded.b.naturalWidth}×${loaded.b.naturalHeight}`
      : `${W}×${H}`;
  // A served URL (/p/<project>/renders/…) or a static one (./renders/…) → the file in the store.
  const repoPath = (u: string) => `${data.store ?? '.pxsig'}/${u.replace(/^\/p\/[^/]+\//, '').replace(/^\.\//, '')}`;
  const sbLink = storybookLink(data.storybook.baseUrl, row, data.check?.manifest?.modes);
  const sb = sbLink.url;
  const cw = W / (m?.grid ?? 64);
  const chh = H / (m?.grid ?? 64);
  const dmaxOf = (hover: Probe | null) => (hover?.baseline && hover.latest ? Math.max(...hover.baseline.map((v, i) => Math.abs(v - hover.latest![i]))) : 255);

  const viewControls = (
    <>
      {mode === 'swipe' ? (
        <Slider
          className={s.sliderCtl}
          label={t('inspector.sliders.swipe')}
          formatValue={(v) => `${v}%`}
          value={split}
          max={100}
          onValueChange={setSplit}
        />
      ) : null}
      {mode === 'onion' ? (
        <Slider
          className={s.sliderCtl}
          label={t('inspector.sliders.opacity')}
          formatValue={(v) => `${v}%`}
          value={onion}
          max={100}
          onValueChange={setOnion}
        />
      ) : null}
      {mode === 'heat' ? (
        <Slider
          className={s.sliderCtl}
          label={t('inspector.sliders.cells')}
          formatValue={(v) => `${v}%`}
          value={heat}
          max={100}
          onValueChange={setHeat}
        />
      ) : null}
      {pixels ? (
        <Slider
          className={s.sliderCtl}
          label={t('inspector.sliders.tolerance')}
          value={tol}
          max={96}
          onValueChange={setTol}
        />
      ) : null}
      {pixels && mode === 'side' ? (
        <label className={s.ctl}>
          <Switch
            checked={showHighlight}
            onCheckedChange={setShowHighlight}
            label={t('inspector.toggles.highlightLabel')}
          />{' '}
          {t('inspector.toggles.highlight')}
        </label>
      ) : null}
      {pixels ? (
        <label className={s.ctl}>
          <Switch
            checked={showBoxes}
            onCheckedChange={setShowBoxes}
            label={t('inspector.toggles.regionsLabel')}
          />{' '}
          {t('inspector.toggles.regions')}
        </label>
      ) : null}
      {detail?.tripped?.length ? (
        <label className={s.ctl}>
          <Switch
            checked={showTiles}
            onCheckedChange={setShowTiles}
            label={t('inspector.toggles.tilesLabel')}
          />{' '}
          {t('inspector.toggles.tiles')}
        </label>
      ) : null}
    </>
  );
  const siblingToggle =
    siblings.length > 1 ? (
      <SegmentedChoice
        value={row.id}
        onValueChange={(v) => onNavigate({ ...target!, row: siblings.find((r) => r.id === v)! })}
        label={t('inspector.variant')}
        options={siblings.map((r) => ({ value: r.id, accessibleLabel: `${r.mode}${r.state ? ` ${r.state}` : ''}`, label: `${r.mode}${r.state ? `·${r.state}` : ''}` }))}
      />
    ) : null;
  const storyNav =
    list.length > 1 ? (
      <span className={s.row}>
        <IconButton size="sm" emphasis="outline" label={t('inspector.nav.prevStory')} title={t('inspector.nav.prevStory')} onClick={() => step(-1)}>
          ‹
        </IconButton>
        <span className={`${s.micro} ${s.counter}`} style={{ minInlineSize: `${String(list.length).length * 2 + 3}ch` }}>
          {t('inspector.nav.position', { index: index + 1, total: list.length })}
        </span>
        <IconButton size="sm" emphasis="outline" label={t('inspector.nav.nextStory')} title={t('inspector.nav.nextStory')} onClick={() => step(1)}>
          ›
        </IconButton>
      </span>
    ) : null;
  const newA11y = row.a11y?.new ?? 0;
  // Rows from older reports may lack `changed`: a failed verdict is a change.
  // A render error has no image of the story: nothing to approve (older reports still
  // mark these changed).
  const changed = !row.error && (row.changed ?? !row.pass);
  // Undo is always rendered, hidden while there is nothing to undo, so the buttons left of it keep
  // their place when a decision is made or undone.
  const undo = (
    <span className={review ? s.slot : s.reserved} aria-hidden={review ? undefined : true}>
      <Button
        size="sm"
        emphasis="ghost"
        disabled={busy || !review}
        onClick={() => act('unreview')}
        title={review?.state === 'approved' ? t('inspector.review.undoTitle') : undefined}
      >
        {t('inspector.review.undo')}
      </Button>
    </span>
  );
  // In the dialog the group stays (disabled) on an entry with nothing to decide, so the story
  // arrows beside it do not move between a changed entry and a passing one.
  const idle = a11yMode ? !(newA11y || review) : !(changed || review);
  const reviewButtons = !canReview || (idle && embedded) ? null : a11yMode ? (
      <>
        <Button size="sm" emphasis="outline" disabled={busy || idle || review?.state === 'rejected'} onClick={() => act('reject')} title={t('inspector.review.rejectA11yTitle')}>
          {t('inspector.review.reject')}
        </Button>
        <Button size="sm" disabled={busy || idle || review?.state === 'accepted'} onClick={() => act('approve')} title={t('inspector.review.acceptTitle')}>
          {newA11y ? t('inspector.review.acceptCount', { count: newA11y }) : t('inspector.review.accept')}
        </Button>
        {undo}
      </>
  ) : (
      <>
        <Button
          size="sm"
          emphasis="outline"
          disabled={busy || idle || review?.state === 'rejected'}
          onClick={() => act('reject')}
          title={t('inspector.review.rejectTitle')}
        >
          {t('inspector.review.reject')}
        </Button>
        <Button
          size="sm"
          disabled={busy || review?.state === 'approved' || !!row.error || (row.pass && !changed)}
          onClick={() => act('approve')}
          title={t('inspector.review.approveTitle')}
        >
          {newA11y && !a11yDecision && !review ? t('inspector.review.approveA11y', { count: newA11y }) : t('inspector.review.approve')}
        </Button>
        {undo}
        {storyOpen.length > 1 && !target?.scenario ? (
          <Button size="sm" emphasis="outline" disabled={busy} onClick={approveAll} title={t('inspector.review.approveStoryTitle')}>
            {t('inspector.review.approveStory', { count: storyOpen.length })}
          </Button>
        ) : null}
      </>
  );
  // Render and check this entry again (the server queue; never writes a baseline).
  const recheckButton =
    canReview && !target?.scenario ? (
      <Button size="sm" emphasis="ghost" disabled={busy || checking} onClick={recheckOne} title={t('inspector.review.recheckTitle')}>
        {checking ? t('app.check.running', { count: 1 }) : t('inspector.review.recheck')}
      </Button>
    ) : null;
  const actionNote = note ? (
    <div className={s.note} role="status">
      <span>{note}</span>
    </div>
  ) : null;
  const desc = row.reasons?.length ? row.reasons.join(' · ') : row.pass ? t('inspector.withinGate') : (row.error ?? '');
  // Embedded (Storybook panel) there is no Dialog around the body, so no Dialog parts. The title is
  // the level below the page's hidden h1, so the outline skips no level.
  const Title = embedded ? 'h2' : DialogTitle;
  const Desc = embedded ? 'p' : DialogDescription;

  // --- review session: progress while deciding, then a summary with the next steps ---------------
  const session = embedded ? null : (target?.session ?? null);
  const decided = session ? list.filter((r) => decisionOf(data, session, r.id)).length : 0;
  const approvedRows = session ? list.filter((r) => ['approved', 'accepted'].includes(decisionOf(data, session, r.id)?.state ?? '')) : [];
  const rejectedRows = session ? list.filter((r) => decisionOf(data, session, r.id)?.state === 'rejected') : [];
  const complete = !!session && list.length > 0 && decided === list.length && !stay;
  blockKeys.current = complete;
  const progress = session ? (
    <div className={s.sessionBar}>
      <strong>{t(`inspector.session.${session}`)}</strong>
      <Progress className={s.grow} value={Math.round((decided / (list.length || 1)) * 100)} label={t('inspector.session.label')} />
      <span className={s.micro}>{t('inspector.session.progress', { done: decided, total: list.length, left: list.length - decided })}</span>
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
      <Dialog open onOpenChange={(o) => !o && onClose()} className={s.summaryDialog}>
          {progress}
          <div className={s.summary}>
            <DialogTitle className={s.insTitle}>{t('inspector.session.complete')}</DialogTitle>
            <KeyValueList labelWidth="30%">
              <KeyValueItem label={t(a11yMode ? 'inspector.session.accepted' : 'inspector.session.approved', { count: approvedRows.length })}>
                {a11yMode
                  ? tx('inspector.session.acceptedNext', { file: <Cmd>{`${data.store ?? '.pxsig'}/a11y.json`}</Cmd> })
                  : tx('inspector.session.approvedNext', { store: <Cmd>{data.store ?? '.pxsig'}</Cmd> })}
              </KeyValueItem>
              {rejectedRows.length ? (
                <KeyValueItem label={t('inspector.session.rejected', { count: rejectedRows.length })}>
                  <span className={s.stack}>
                    <span>{t(a11yMode ? 'inspector.session.a11yRejectedNext' : 'inspector.session.rejectedNext')}</span>
                    <CopyValue value={`pxsig check ${rejectedRows.map((r) => r.id).join(' ')}`} />
                  </span>
                </KeyValueItem>
              ) : null}
            </KeyValueList>
            <span className={s.row}>
              <Button size="sm" onClick={() => (onGo ? onGo('overview') : onClose())}>
                {t('inspector.session.back')}
              </Button>
              {rejectedRows.length && onGo ? (
                <Button size="sm" emphasis="outline" onClick={() => (a11yMode ? onGo('a11y') : onGo('stories', 'rejected'))}>
                  {t('inspector.session.viewRejected')}
                </Button>
              ) : null}
              <Button size="sm" emphasis="ghost" onClick={() => setStay(true)}>
                {t('inspector.session.backToEntries')}
              </Button>
            </span>
          </div>
      </Dialog>
    );

  const stageImages = loaded && loaded !== 'missing' ? loaded : null;
  const body = (
    <div onKeyDown={embedded ? (e) => onKey(e.nativeEvent) : undefined} style={{ display: 'contents' }}>
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
        <div className={s.insHead}>
          <div className={s.insInfo}>
            <div className={s.insContext}>
              <StatusOf status={statusOf(row, data.review)} />
              {siblingToggle}
              <span className={`${s.micro} ${s.clip}`}>
                {target!.scenario
                  ? t('inspector.contextScenario', { name: target!.scenario.name })
                  : `${t('inspector.contextLatest', { mode: row.mode })}${row.state ? ` · ${row.state}` : ''}${row.browser && row.browser !== 'chromium' ? ` · ${row.browser}` : ''}`}
                {sbLink.state ? <span className={s.muted}> · {t('inspector.storybook.state', { state: sbLink.state })}</span> : null}
              </span>
            </div>
            <Title ref={titleRef} tabIndex={-1} className={s.insTitle} title={row.id}>
              {row.id}
            </Title>
            <Desc className={`${s.micro} ${s.clip}`} style={{ margin: 0 }} title={desc || undefined}>
              {desc || '\u00a0'}
            </Desc>
          </div>
          <div className={s.insActions}>
            {storyNav}
            {reviewButtons}
            {recheckButton}
            {embedded ? null : (
              <Button size="sm" emphasis="outline" onClick={onClose}>
                {t('inspector.close')}
              </Button>
            )}
          </div>
        </div>
      )}

      {rejectedNote}
      {actionNote}
      <Toolbar size="sm" className={s.insToolbar}>
        <ToolbarStart>
          {embedded ? <StatusOf status={statusOf(row, data.review)} /> : null}
          {/* The diff viewer's mode group and zoom controls, rendered with the contract's components. */}
          <DiffViewer.ModeGroup
            label={t('inspector.modes.label')}
            render={(_, g) => (
              <SegmentedChoice
                value={g.mode}
                onValueChange={(v) => g.setMode(v as Mode)}
                label={t('inspector.modes.label')}
                options={MODES.map((k, i) => ({
                  value: k,
                  title: `${t(`inspector.modes.${k}`)} (${i + 1})`,
                  accessibleLabel: t(`inspector.modes.${k}`),
                  label: embedded ? t(`inspector.modes.${k}Short`) : t(`inspector.modes.${k}`),
                }))}
              />
            )}
          />
          <DiffViewer.ZoomControls
            render={(_, z) => (
              <span className={s.row}>
                <IconButton emphasis="outline" label={t('inspector.zoomOut')} onClick={z.zoomOut}>
                  −
                </IconButton>
                <span className={s.mono} style={{ minInlineSize: '3.5rem', textAlign: 'center', fontSize: '0.75rem' }} aria-live="polite">
                  {Math.round(z.zoom * 100)}%
                </span>
                <IconButton emphasis="outline" label={t('inspector.zoomIn')} onClick={z.zoomIn}>
                  +
                </IconButton>
                <Button emphasis="outline" title={t('inspector.fitTitle')} onClick={z.fit}>
                  {t('inspector.fit')}
                </Button>
                <Button emphasis="outline" title={t('inspector.actualTitle')} onClick={z.actual}>
                  {t('inspector.actual')}
                </Button>
              </span>
            )}
          />
          {embedded ? null : viewControls}
        </ToolbarStart>
        <ToolbarEnd>
          {embedded ? siblingToggle : null}
          {embedded ? reviewButtons : null}
          {embedded ? (
            <label className={s.ctl}>
              <Switch checked={showSide} onCheckedChange={setShowSide} label={t('inspector.toggles.detailsLabel')} />{' '}
              {t('inspector.toggles.details')}
            </label>
          ) : null}
          {pixels && !embedded ? (
            <span className={s.row}>
              <IconButton emphasis="outline" disabled={!regions.length} label={t('inspector.nav.prevChange')} onClick={() => stepRegion(-1)}>
                ‹
              </IconButton>
              <span className={s.micro}>
                {regions.length
                  ? t('inspector.nav.change', { index: region < 0 ? '–' : region + 1, total: regions.length })
                  : t('inspector.nav.noChanges')}
              </span>
              <IconButton emphasis="outline" disabled={!regions.length} label={t('inspector.nav.nextChange')} onClick={() => stepRegion(1)}>
                ›
              </IconButton>
            </span>
          ) : null}
        </ToolbarEnd>
      </Toolbar>

      <div className={s.insMain}>
        <div className={s.insStageWrap}>
          {loaded === 'missing' ? (
            <div className={s.empty}>{t('inspector.missing', { before: p.before, after: p.after })}</div>
          ) : loaded ? (
            <Stage
              analysis={analysis}
              cells={loaded.cells}
              heatImg={loaded.heat}
              tiles={detail?.tripped?.length ? { indices: detail.tripped, tile: 16 } : null}
              labels={[p.beforeLabel, loaded.a ? p.afterLabel : t('inspector.renders.firstRender')]}
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
                      ['A', t(a11yMode ? 'inspector.keys.accept' : 'inspector.keys.approve')],
                      ['R', t('inspector.keys.reject')],
                    ]
                  : []),
                ...(embedded ? [] : [['Esc', t('inspector.keys.close')]]),
              ].map(([k, v]) => (
                <span key={k}>
                  <Kbd>{k}</Kbd> {v}
                </span>
              ))}
            </div>
          )}
        </div>

        {showSide ? (
          <aside className={s.insSide}>
            {embedded ? (
              <section className={s.sideSection}>
                <h3 className={s.sectionTitle}>{t('inspector.sections.view')}</h3>
                <div className={s.stack}>{viewControls}</div>
                {pixels ? (
                  <span className={s.row}>
                    <IconButton size="sm" emphasis="outline" disabled={!regions.length} label={t('inspector.nav.prevChange')} onClick={() => stepRegion(-1)}>
                      ‹
                    </IconButton>
                    <span className={s.micro}>
                      {regions.length
                        ? t('inspector.nav.change', { index: region < 0 ? '–' : region + 1, total: regions.length })
                        : t('inspector.nav.noChanges')}
                    </span>
                    <IconButton size="sm" emphasis="outline" disabled={!regions.length} label={t('inspector.nav.nextChange')} onClick={() => stepRegion(1)}>
                      ›
                    </IconButton>
                  </span>
                ) : null}
              </section>
            ) : null}
            <section className={s.sideSection}>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>{t('inspector.sections.pixel')}</h3>
                {embedded ? null : (
                  <Button
                    href={sb}
                    external
                    size="sm"
                    emphasis="outline"
                    title={sbLink.globals ? t('inspector.storybook.title', { globals: sbLink.globals }) : t('inspector.storybook.titlePlain')}
                  >
                    {t('inspector.storybook.open')}
                    <Icon name="external" size="1em" />
                  </Button>
                )}
              </div>
              <div className={s.readout}>
                {loaded && loaded !== 'missing' && !loaded.a ? (
                  <span className={s.muted}>{t('inspector.pixel.noBaseline')}</span>
                ) : !pixels ? (
                  <span className={s.muted}>{tx('inspector.pixel.needsServer', { command: <Cmd>pxsig serve</Cmd> })}</span>
                ) : (
                  // The same rows with or without a pointer, so the panel never changes height.
                  <DiffViewer.Probe>
                    {(probe) => {
                      const hover = probe && { ix: probe.x, iy: probe.y, before: probe.baseline, after: probe.latest };
                      const dmax = dmaxOf(probe);
                      return (
                  <>
                    <div className={s.pxRow}>
                      {hover ? (
                        <>
                          <span className={`${s.mono} ${s.pxCoords}`}>{t('inspector.pixel.coords', { x: hover.ix, y: hover.iy })}</span>
                          <span className={`${s.mono} ${s.muted} ${s.oneLine}`}>
                            {t('inspector.pixel.cellTile', { cx: Math.floor(hover.ix / cw), cy: Math.floor(hover.iy / chh), tx: Math.floor(hover.ix / 16), ty: Math.floor(hover.iy / 16) })}
                          </span>
                        </>
                      ) : (
                        <span className={`${s.muted} ${s.oneLine}`}>{t('inspector.pixel.hover')}</span>
                      )}
                    </div>
                    {(
                      [
                        [t('inspector.pixel.before'), hover?.before],
                        [t('inspector.pixel.after'), hover?.after],
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
                          {!hover ? '—' : v ? `${hex(v[0], v[1], v[2])}${v[3] < 255 ? ` α${v[3]}` : ''}` : t('inspector.pixel.outside')}
                        </span>
                      </div>
                    ))}
                    <div className={s.pxRow}>
                      <span className={s.micro}>{t('inspector.pixel.maxDelta')}</span>
                      {!hover ? (
                        <span className={s.mono}>—</span>
                      ) : dmax > tol ? (
                        <Badge tone="danger">{dmax}</Badge>
                      ) : (
                        <span className={s.mono}>{dmax}</span>
                      )}
                    </div>
                  </>
                      );
                    }}
                  </DiffViewer.Probe>
                )}
              </div>
            </section>

            {pixels && analysis ? (
              <section className={s.sideSection}>
                <h3 className={s.sectionTitle}>{t('inspector.sections.changes')}</h3>
                <KeyValueList labelWidth="45%">
                  <KeyValueItem label={t('inspector.changes.pixels')}>
                    <span className={s.mono}>
                      {fmt.num(analysis.changed)} (
                      {((analysis.changed / (W * H || 1)) * 100).toFixed(
                        analysis.changed && analysis.changed / (W * H) < 0.001 ? 3 : 2
                      )}
                      %)
                    </span>
                  </KeyValueItem>
                  <KeyValueItem label={t('inspector.changes.regions')}>
                    <span className={s.mono}>{regions.length}</span>
                  </KeyValueItem>
                  <KeyValueItem label={t('inspector.changes.maxDelta')}>
                    <span className={s.mono}>{analysis.maxD}</span>
                  </KeyValueItem>
                  <KeyValueItem label={t('inspector.changes.size')}>
                    <span className={s.mono}>{sizeNote}</span>
                  </KeyValueItem>
                </KeyValueList>
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
                <h3 className={s.sectionTitle}>{t('inspector.sections.metrics')}</h3>
                <KeyValueList labelWidth="45%">
                  <KeyValueItem label={t('inspector.metrics.ssim')}>
                    <span className={s.mono}>{m.ssim}</span>{' '}
                    {m.ssim < 0.99 ? <Badge tone="danger">&lt; 0.99</Badge> : null}
                  </KeyValueItem>
                  <KeyValueItem label={t('inspector.metrics.cellsOver', { threshold: m.threshold })}>
                    <span className={s.mono}>
                      {m.changedCells} ({m.changedCellsPct}%)
                    </span>
                  </KeyValueItem>
                  <KeyValueItem label={t('inspector.metrics.maxCell')}>
                    <span className={s.mono}>{m.maxCellDiff}</span>
                  </KeyValueItem>
                  <KeyValueItem label={t('inspector.metrics.edge')}>
                    <span className={s.mono}>{m.edgeDiffPct}%</span>
                  </KeyValueItem>
                  {detail ? (
                    <>
                      <KeyValueItem label={t('inspector.metrics.tilesChanged')}>
                        <span className={s.mono}>{detail.changedTiles}</span>{' '}
                        {detail.changedTiles + detail.newEdgeTiles >= 3 ? (
                          <Badge tone="danger">≥ 3</Badge>
                        ) : null}
                      </KeyValueItem>
                      <KeyValueItem label={t('inspector.metrics.newEdges')}>
                        <span className={s.mono}>{detail.newEdgeTiles}</span>
                      </KeyValueItem>
                      <KeyValueItem label={t('inspector.metrics.maxBlock')}>
                        <span className={s.mono}>{detail.maxBlockDelta}</span>
                      </KeyValueItem>
                    </>
                  ) : null}
                </KeyValueList>
                {hasArtifacts ? (
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
                ) : (
                  <span className={s.muted}>{t('inspector.artifacts.notWritten')}</span>
                )}
              </section>
            ) : null}

            {row.a11y?.violations?.length ? (
              <section className={s.sideSection}>
                <h3 className={s.sectionTitle}>{t('inspector.sections.a11y', { count: row.a11y.violations.length })}</h3>
                <span className={s.muted}>
                  {newA11y
                    ? served && !target?.scenario
                      ? t('inspector.a11y.stateNew', { count: newA11y })
                      : tx('inspector.a11y.stateNewStatic', { count: newA11y, command: <Cmd>pxsig serve</Cmd> })
                    : t('inspector.a11y.stateAccepted')}
                </span>
                <ul className={s.resources}>
                  {row.a11y.violations.map((v) => (
                    <li key={v.id} className={s.a11yItem}>
                      <StatusBadge icon="dot" label={v.impact ?? 'n/a'} tone={v.impact === 'critical' || v.impact === 'serious' ? 'danger' : 'warning'} />
                      <span className={s.a11yRule} title={v.help}>
                        {v.id} · {t('inspector.a11y.nodes', { count: v.nodes })}
                      </span>
                      {(row.a11y?.baseline ? !row.a11y.baseline.includes(v.id) : newA11y > 0) ? (
                        <Badge tone="danger">{t('inspector.a11y.new')}</Badge>
                      ) : (
                        <>
                          <Badge>{t('inspector.a11y.accepted')}</Badge>
                          {canReview ? (
                            <Button size="sm" emphasis="ghost" disabled={busy} onClick={() => unaccept(v.id)} title={t('inspector.a11y.unacceptTitle')}>
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
                          {t(a11yDecision.state === 'accepted' ? 'inspector.review.a11yAccepted' : 'inspector.review.a11yRejected')}
                        </Badge>
                        <Button size="sm" emphasis="ghost" disabled={busy} onClick={() => act('unreview', true)}>
                          {t('inspector.review.undo')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" emphasis="outline" disabled={busy} onClick={() => act('reject', true)} title={t('inspector.review.rejectA11yTitle')}>
                          {t('inspector.review.reject')}
                        </Button>
                        <Button size="sm" emphasis="outline" disabled={busy} onClick={() => act('approve', true)} title={t('inspector.review.acceptTitle')}>
                          {newA11y ? t('inspector.review.acceptCount', { count: newA11y }) : t('inspector.review.accept')}
                        </Button>
                      </>
                    )}
                  </span>
                ) : null}
              </section>
            ) : null}

            <section className={s.sideSection}>
              <h3 className={s.sectionTitle}>{t('inspector.sections.files')}</h3>
              <ul className={s.resources}>
                {(
                  [
                    [p.beforeLabel, p.before],
                    [p.afterLabel, p.after],
                    ...(hasArtifacts
                      ? [
                          [t('inspector.files.baseSig'), p.baseSig],
                          [t('inspector.files.curSig'), p.curSig],
                          [t('inspector.files.heat'), p.heat],
                          [t('inspector.files.page'), p.page],
                        ]
                      : []),
                    ...(p.record ? [[t('inspector.files.record'), p.record]] : []),
                  ] as [string, string][]
                ).map(([label, url]) => (
                  <li key={label}>
                    <Link href={url} external className={s.grow}>
                      {label}
                    </Link>
                    <span className={`${s.mono} ${s.muted}`}>{sizes[url] ?? ''}</span>
                    <CopyPath value={repoPath(url)} label={label} />
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
      </DiffViewer.Root>
    </div>
  );

  if (embedded) return <div className={s.embed}>{body}</div>;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} className={s.inspector} initialFocus={titleRef}>
      {body}
    </Dialog>
  );
}
