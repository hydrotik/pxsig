/**
 * The inspector's controls (Inspector.tsx): the toolbar's view choice, zoom buttons and change
 * arrows, the view's sliders and switches, the story's other modes and states, the story arrows,
 * the review buttons with Undo, Re-check, and the keys under the stage.
 */
import { Button, IconButton, Kbd, SegmentedChoice, Slider, Switch } from '@ui';
import type { Data, Row } from '../data';
import { t } from '../copy';
import * as s from '../dashboard.css';
import type { ModeGroupState, ZoomState } from '../diff-viewer';
import type { Analysis } from './analyse';
import type { InspectTarget, Loaded } from './Inspector';
import { MODES } from './prefs';
import type { Mode } from './Stage';

/** The toolbar's view choice (the diff viewer's mode group, drawn with the contract's control). */
export function ModeChoice({ g, embedded }: { g: ModeGroupState; embedded: boolean }) {
  return (
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
  );
}

/** The toolbar's zoom buttons: the diff viewer's zoom controls, drawn with the contract's parts. */
export function ZoomButtons({ z }: { z: ZoomState }) {
  return (
    <span className={s.row}>
      <IconButton emphasis="outline" label={t('inspector.zoomOut')} onClick={z.zoomOut}>
        −
      </IconButton>
      <span
        className={s.mono}
        style={{ minInlineSize: '3.5rem', textAlign: 'center', fontSize: '0.75rem' }}
        aria-live="polite"
      >
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
  );
}

/** The toolbar's previous and next change. */
export function ChangeNav({
  regions,
  region,
  stepRegion,
}: {
  regions: Analysis['regions'];
  region: number;
  stepRegion: (d: number) => unknown;
}) {
  return (
    <span className={s.row}>
      <IconButton
        emphasis="outline"
        disabled={!regions.length}
        label={t('inspector.nav.prevChange')}
        onClick={() => stepRegion(-1)}
      >
        ‹
      </IconButton>
      <span className={s.micro}>
        {regions.length
          ? t('inspector.nav.change', {
              index: region < 0 ? '–' : region + 1,
              total: regions.length,
            })
          : t('inspector.nav.noChanges')}
      </span>
      <IconButton
        emphasis="outline"
        disabled={!regions.length}
        label={t('inspector.nav.nextChange')}
        onClick={() => stepRegion(1)}
      >
        ›
      </IconButton>
    </span>
  );
}

/** The keys, under the stage. */
export function KeyHelp({
  canReview,
  a11yMode,
  embedded,
}: {
  canReview: boolean;
  a11yMode: boolean;
  embedded: boolean;
}) {
  return (
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
  );
}

export function ViewControls({
  mode,
  split,
  setSplit,
  onion,
  setOnion,
  heat,
  setHeat,
  pixels,
  tol,
  setTol,
  showHighlight,
  setShowHighlight,
  showBoxes,
  setShowBoxes,
  detail,
  showTiles,
  setShowTiles,
}: {
  mode: Mode;
  split: number;
  setSplit: (v: number) => void;
  onion: number;
  setOnion: (v: number) => void;
  heat: number;
  setHeat: (v: number) => void;
  pixels: Loaded | null;
  tol: number;
  setTol: (v: number) => void;
  showHighlight: boolean;
  setShowHighlight: (v: boolean) => void;
  showBoxes: boolean;
  setShowBoxes: (v: boolean) => void;
  detail: Row['detail'];
  showTiles: boolean;
  setShowTiles: (v: boolean) => void;
}) {
  return (
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
}

export function SiblingToggle({
  siblings,
  row,
  target,
  onNavigate,
  keepHeight = false,
}: {
  siblings: Row[];
  row: Row;
  target: InspectTarget | null;
  onNavigate: (t: InspectTarget) => void;
  /** Without siblings, hold the toggle's height (no width), so the header does not shrink. */
  keepHeight?: boolean;
}) {
  if (siblings.length < 2)
    return keepHeight ? (
      <span className={s.heightOnly} aria-hidden>
        <SegmentedChoice
          value={row.id}
          onValueChange={() => {}}
          label={t('inspector.variant')}
          options={[{ value: row.id, label: row.mode }]}
        />
      </span>
    ) : null;
  return siblings.length > 1 ? (
    <SegmentedChoice
      value={row.id}
      onValueChange={(v) => onNavigate({ ...target!, row: siblings.find((r) => r.id === v)! })}
      label={t('inspector.variant')}
      options={siblings.map((r) => ({
        value: r.id,
        accessibleLabel: `${r.mode}${r.state ? ` ${r.state}` : ''}`,
        label: `${r.mode}${r.state ? `·${r.state}` : ''}`,
      }))}
    />
  ) : null;
}

export function StoryNav({
  list,
  index,
  step,
}: {
  list: Row[];
  index: number;
  step: (d: number) => void;
}) {
  return list.length > 1 ? (
    <span className={s.row}>
      <IconButton
        size="sm"
        emphasis="outline"
        label={t('inspector.nav.prevStory')}
        title={t('inspector.nav.prevStory')}
        onClick={() => step(-1)}
      >
        ‹
      </IconButton>
      <span
        className={`${s.micro} ${s.counter}`}
        style={{ minInlineSize: `${String(list.length).length * 2 + 3}ch` }}
      >
        {t('inspector.nav.position', { index: index + 1, total: list.length })}
      </span>
      <IconButton
        size="sm"
        emphasis="outline"
        label={t('inspector.nav.nextStory')}
        title={t('inspector.nav.nextStory')}
        onClick={() => step(1)}
      >
        ›
      </IconButton>
    </span>
  ) : null;
}

// Undo is always rendered, hidden while there is nothing to undo, so the buttons left of it keep
// their place when a decision is made or undone.
export function Undo({
  review,
  busy,
  act,
}: {
  review: Data['review'][string] | NonNullable<Data['a11yReview']>[string] | undefined;
  busy: boolean;
  act: (action: 'approve' | 'reject' | 'unreview', a11y?: boolean) => Promise<void>;
}) {
  return (
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
}

export function ReviewButtons({
  canReview,
  idle,
  embedded,
  a11yMode,
  busy,
  review,
  act,
  newA11y,
  changed,
  row,
  a11yDecision,
  storyOpen,
  target,
  approveAll,
  readOnly = false,
}: {
  canReview: boolean;
  idle: boolean;
  embedded: boolean;
  a11yMode: boolean;
  busy: boolean;
  review: Data['review'][string] | NonNullable<Data['a11yReview']>[string] | undefined;
  act: (action: 'approve' | 'reject' | 'unreview', a11y?: boolean) => Promise<void>;
  newA11y: number;
  changed: boolean;
  row: Row;
  a11yDecision: NonNullable<Data['a11yReview']>[string] | undefined;
  storyOpen: Row[];
  target: InspectTarget | null;
  approveAll: () => Promise<void>;
  /** No dashboard link: every button stays in place, disabled, and says why. */
  readOnly?: boolean;
}) {
  const undo = <Undo review={review} busy={busy || readOnly} act={act} />;
  const why = readOnly ? t('inspector.review.readOnlyTitle') : undefined;
  // Reject and Approve keep their place: they end the group, at its right edge, with labels that
  // never change width. Whatever comes and goes (Undo, Approve story, the a11y note) sits to their
  // left, so it can only push away from them (test/flows-decisions.test.mjs measures it).
  return !canReview || (idle && embedded) ? null : a11yMode ? (
    <>
      {undo}
      {newA11y ? (
        <span className={s.micro}>{t('inspector.review.newCount', { count: newA11y })}</span>
      ) : null}
      <Button
        size="sm"
        emphasis="outline"
        disabled={readOnly || busy || idle || review?.state === 'rejected'}
        onClick={() => act('reject')}
        title={why ?? t('inspector.review.rejectA11yTitle')}
      >
        {t('inspector.review.reject')}
      </Button>
      <Button
        size="sm"
        disabled={readOnly || busy || idle || review?.state === 'accepted'}
        onClick={() => act('approve')}
        title={why ?? t('inspector.review.acceptTitle')}
      >
        {t('inspector.review.accept')}
      </Button>
    </>
  ) : (
    <>
      {undo}
      {storyOpen.length > 1 && !target?.scenario ? (
        <Button
          size="sm"
          emphasis="outline"
          disabled={readOnly || busy}
          onClick={approveAll}
          title={why ?? t('inspector.review.approveStoryTitle')}
        >
          {t('inspector.review.approveStory', { count: storyOpen.length })}
        </Button>
      ) : null}
      {newA11y && !a11yDecision && !review ? (
        <span className={s.micro}>{t('inspector.review.approveA11y', { count: newA11y })}</span>
      ) : null}
      <Button
        size="sm"
        emphasis="outline"
        disabled={readOnly || busy || idle || review?.state === 'rejected'}
        onClick={() => act('reject')}
        title={why ?? t('inspector.review.rejectTitle')}
      >
        {t('inspector.review.reject')}
      </Button>
      <Button
        size="sm"
        disabled={
          readOnly || busy || review?.state === 'approved' || !!row.error || (row.pass && !changed)
        }
        onClick={() => act('approve')}
        title={why ?? t('inspector.review.approveTitle')}
      >
        {t('inspector.review.approve')}
      </Button>
    </>
  );
}

// Render and check this entry again (the server queue; never writes a baseline).
export function RecheckButton({
  canReview,
  target,
  busy,
  checking,
  recheckOne,
}: {
  canReview: boolean;
  target: InspectTarget | null;
  busy: boolean;
  checking: boolean;
  recheckOne: () => Promise<void>;
}) {
  return canReview && !target?.scenario ? (
    <Button
      size="sm"
      emphasis="ghost"
      disabled={busy || checking}
      onClick={recheckOne}
      title={t('inspector.review.recheckTitle')}
    >
      {checking ? t('app.check.running', { count: 1 }) : t('inspector.review.recheck')}
    </Button>
  ) : null;
}
