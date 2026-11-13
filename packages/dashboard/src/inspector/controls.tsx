/**
 * The inspector's controls (Inspector.tsx): the toolbar's view choice, zoom buttons and change
 * arrows, the view's sliders and switches, the story's other modes and states, the story arrows,
 * the review buttons with Undo, Re-check, and the keys under the stage.
 */
import type { ReactNode } from 'react';
import { Button, IconButton, Kbd, SegmentedChoice, Slider, Switch } from '@ui';
import type { Data, Row } from '../data';
import { t } from '../copy';
import * as s from '../dashboard.css';
import type { ModeGroupState, ZoomState } from '../diff-viewer';
import type { Analysis } from './analyse';
import type { InspectTarget, Loaded } from './Inspector';
import { blockedLine } from './masks';
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
  masksOnly = false,
}: {
  regions: Analysis['regions'];
  region: number;
  stepRegion: (d: number) => unknown;
  /** A masks-only change (masks.ts): said in place of "No changes". */
  masksOnly?: boolean;
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
          : t(masksOnly ? 'inspector.nav.masksOnly' : 'inspector.nav.noChanges')}
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
        ['O', t('inspector.keys.originals')],
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
  showHighlight,
  setShowHighlight,
  showBoxes,
  setShowBoxes,
  detail,
  showTiles,
  setShowTiles,
  originals,
  setOriginals,
  isNew,
}: {
  mode: Mode;
  split: number;
  setSplit: (v: number) => void;
  onion: number;
  setOnion: (v: number) => void;
  heat: number;
  setHeat: (v: number) => void;
  pixels: Loaded | null;
  showHighlight: boolean;
  setShowHighlight: (v: boolean) => void;
  showBoxes: boolean;
  setShowBoxes: (v: boolean) => void;
  detail: Row['detail'];
  showTiles: boolean;
  setShowTiles: (v: boolean) => void;
  /** Originals: the images with no analysis; the overlay switches show disabled. */
  originals: boolean;
  setOriginals: (v: boolean) => void;
  /** A new entry (no baseline) has nothing to hide, so no Originals switch. */
  isNew: boolean;
}) {
  return (
    <>
      {isNew ? null : (
        <label className={s.ctl} data-control>
          <Switch
            checked={originals}
            onCheckedChange={setOriginals}
            label={t('inspector.toggles.originalsLabel')}
          />{' '}
          {t('inspector.toggles.originals')}
        </label>
      )}
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
      {pixels && mode === 'side' ? (
        <label className={s.ctl} data-control>
          <Switch
            checked={showHighlight && !originals}
            onCheckedChange={setShowHighlight}
            disabled={originals}
            label={t('inspector.toggles.highlightLabel')}
          />{' '}
          {t('inspector.toggles.highlight')}
        </label>
      ) : null}
      {pixels ? (
        <label className={s.ctl} data-control>
          <Switch
            checked={showBoxes && !originals}
            onCheckedChange={setShowBoxes}
            disabled={originals}
            label={t('inspector.toggles.regionsLabel')}
          />{' '}
          {t('inspector.toggles.regions')}
        </label>
      ) : null}
      {detail?.tripped?.length ? (
        <label className={s.ctl} data-control>
          <Switch
            checked={showTiles && !originals}
            onCheckedChange={setShowTiles}
            disabled={originals}
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
  pending = null,
  armed = true,
}: {
  canReview: boolean;
  idle: boolean;
  embedded: boolean;
  a11yMode: boolean;
  busy: boolean;
  /** The decision the server is answering: its button names it ("Approving…"). */
  pending?: 'approve' | 'reject' | null;
  /** The entry's images are drawn: until then Reject and Approve stay disabled. */
  armed?: boolean;
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
  const off = readOnly || busy || !armed;
  // Each decision button in a box that shows the progress cursor and is aria-busy while its request
  // runs (the button itself is disabled then, and a disabled button takes no pointer).
  const decision = (action: 'approve' | 'reject', button: ReactNode, title?: string) => (
    <span className={s.decision} aria-busy={pending === action || undefined} title={title}>
      {button}
    </span>
  );
  // Masks no approval passes (over half the capture, the story root, a data-volatile problem):
  // Approve stays in place, disabled, and its title (also its description) says why.
  const blocked = blockedLine(row);
  const rejectLabel = (
    <DecisionLabel
      label={t('inspector.review.reject')}
      busyLabel={t('inspector.review.rejecting')}
      busy={pending === 'reject'}
    />
  );
  // Reject and Approve keep their place: they end the group, at its right edge, with labels that
  // never change width. Whatever comes and goes (Undo, Approve story, the a11y note) sits to their
  // left, so it can only push away from them (test/flows-decisions.test.mjs measures it).
  return !canReview || (idle && embedded) ? null : a11yMode ? (
    <>
      {undo}
      {newA11y ? (
        <span className={s.micro}>{t('inspector.review.newCount', { count: newA11y })}</span>
      ) : null}
      {decision(
        'reject',
        <Button
          size="sm"
          emphasis="outline"
          disabled={off || idle || review?.state === 'rejected'}
          onClick={() => act('reject')}
          title={why ?? t('inspector.review.rejectA11yTitle')}
        >
          {rejectLabel}
        </Button>
      )}
      {decision(
        'approve',
        <Button
          size="sm"
          disabled={off || idle || review?.state === 'accepted'}
          onClick={() => act('approve')}
          title={why ?? t('inspector.review.acceptTitle')}
        >
          <DecisionLabel
            label={t('inspector.review.accept')}
            busyLabel={t('inspector.review.accepting')}
            busy={pending === 'approve'}
          />
        </Button>
      )}
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
      {decision(
        'reject',
        <Button
          size="sm"
          emphasis="outline"
          disabled={off || idle || review?.state === 'rejected'}
          onClick={() => act('reject')}
          title={why ?? t('inspector.review.rejectTitle')}
        >
          {rejectLabel}
        </Button>
      )}
      {decision(
        'approve',
        <Button
          size="sm"
          disabled={
            off ||
            !!blocked ||
            review?.state === 'approved' ||
            !!row.error ||
            (row.pass && !changed)
          }
          onClick={() => act('approve')}
          title={why ?? blocked ?? t('inspector.review.approveTitle')}
        >
          <DecisionLabel
            label={t('inspector.review.approve')}
            busyLabel={t('inspector.review.approving')}
            busy={pending === 'approve'}
          />
        </Button>,
        blocked ?? undefined
      )}
    </>
  );
}

/**
 * A decision button's label and its "…ing" form, stacked in one cell: the button is as wide as the
 * longer one either way, so Reject and Approve never move while a request runs.
 */
function DecisionLabel({
  label,
  busyLabel,
  busy,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
}) {
  return (
    <span className={s.labelStack}>
      <span className={busy ? s.labelHidden : undefined}>{label}</span>
      <span className={busy ? undefined : s.labelHidden}>{busyLabel}</span>
    </span>
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
