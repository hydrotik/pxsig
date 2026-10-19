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
import { type Data, type Row, fmt, pathsFor, reviewAction, served, statusOf } from '../data';
import { analyse, cellsLayer, hex, loadImg, readPixels, type Analysis } from './analyse';
import { Stage, type Hover, type Mode, type StageApi } from './Stage';
import { StatusOf } from '../parts/StatusOf';
import * as s from '../dashboard.css';

export interface InspectTarget {
  row: Row;
  /** Scenario renders: { tag, name }; null for the latest check. */
  scenario: { tag: string; name: string } | null;
  /** The list being browsed (←/→). */
  list: Row[];
}

const MODES: [Mode, string, string][] = [
  ['side', 'Side by side', 'Side'],
  ['swipe', 'Swipe', 'Swipe'],
  ['onion', 'Onion skin', 'Onion'],
  ['diff', 'Pixel diff', 'Diff'],
  ['heat', 'Signature cells', 'Cells'],
];

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
  embedded = false,
}: {
  data: Data;
  target: InspectTarget | null;
  onNavigate(t: InspectTarget): void;
  onClose(): void;
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
        const next = list.findIndex(
          (r, i) => i > index && !r.pass && !data.review[r.id] && r.id !== row.id
        );
        if (next >= 0) onNavigate({ ...target!, row: list[next] });
      }
    } catch (e) {
      alert(`${action} failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Other modes / states of the same story: switch between them in place.
  const siblings =
    row && !target?.scenario
      ? (data.check?.rows ?? []).filter((r) => r.story === row.story && !r.skipped)
      : [];

  const onKey = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('[role="slider"]') && e.key.startsWith('Arrow')) return;
    const k = e.key;
    const run = (f: () => void) => (e.preventDefault(), f());
    if (k >= '1' && k <= '5') return run(() => setMode(MODES[Number(k) - 1][0]));
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
          label="Swipe"
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
          label="Opacity"
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
          label="Cells"
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
          label="Tolerance"
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
            aria-label="Highlight changed pixels"
          />{' '}
          Highlight
        </label>
      ) : null}
      {pixels ? (
        <label className={s.ctl}>
          <Switch
            checked={showBoxes}
            onCheckedChange={setShowBoxes}
            aria-label="Box change regions"
          />{' '}
          Regions
        </label>
      ) : null}
      {detail?.tripped?.length ? (
        <label className={s.ctl}>
          <Switch
            checked={showTiles}
            onCheckedChange={setShowTiles}
            aria-label="Show detail tiles that tripped"
          />{' '}
          Detail tiles
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
        aria-label="Mode"
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
          aria-label="Previous story (←)"
          title="Previous story (←)"
          onClick={() => step(-1)}
        >
          ‹
        </Button>
        <span className={s.micro}>
          {index + 1} / {list.length}
        </span>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Next story (→)"
          title="Next story (→)"
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
          title="Mark this change as unwanted (R)"
        >
          Reject
        </Button>
        <Button
          size="sm"
          disabled={busy || review?.state === 'approved' || (row.pass && !row.changed)}
          onClick={() => act('approve')}
          title="Accept the latest render as the new baseline (A)"
        >
          Approve
        </Button>
        {review ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('unreview')}>
            Undo
          </Button>
        ) : null}
      </>
    ) : null;
  // Embedded (Storybook panel) there is no Dialog around the body, so no Dialog parts.
  const Title = embedded ? 'h3' : DialogTitle;
  const Desc = embedded ? 'p' : DialogDescription;
  const body = (
    <div onKeyDown={onKey} style={{ display: 'contents' }}>
      {embedded ? null : (
        <div className={s.insHead}>
          <div style={{ minInlineSize: 0 }}>
            <div className={s.micro}>
              {target!.scenario
                ? `scenario · ${target!.scenario.name}`
                : `latest check · ${row.mode}${row.state ? ` · ${row.state}` : ''}${row.browser && row.browser !== 'chromium' ? ` · ${row.browser}` : ''}`}
            </div>
            <Title className={s.insTitle}>{row.id}</Title>
            <Desc className={s.micro} style={{ margin: 0 }}>
              {row.reasons?.length
                ? row.reasons.join(' · ')
                : row.pass
                  ? 'Within the gate'
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
                Close
              </Button>
            )}
          </div>
        </div>
      )}

      <Toolbar className={s.insToolbar}>
        <ToolbarLeft>
          {embedded ? <StatusOf status={statusOf(row, data.review)} /> : null}
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as Mode)}
            aria-label="Compare mode"
          >
            {MODES.map(([k, label, short], i) => (
              <ToggleGroupItem key={k} value={k} title={`${label} (${i + 1})`} aria-label={label}>
                {embedded ? short : label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className={s.row}>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Zoom out (−)"
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
              aria-label="Zoom in (+)"
              onClick={() => stage.current?.zoomBy(1.5)}
            >
              +
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Fit (F)"
              onClick={() => stage.current?.fit()}
            >
              Fit
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Actual size (0)"
              onClick={() => stage.current?.zoomTo(1)}
            >
              1:1
            </Button>
          </span>
          {embedded ? null : viewControls}
        </ToolbarLeft>
        <ToolbarRight>
          {embedded ? siblingToggle : null}
          {embedded ? reviewButtons : null}
          {embedded ? (
            <label className={s.ctl}>
              <Switch checked={showSide} onCheckedChange={setShowSide} aria-label="Show details" />{' '}
              Details
            </label>
          ) : null}
          {pixels && !embedded ? (
            <span className={s.row}>
              <Button
                size="icon-sm"
                variant="outline"
                disabled={!regions.length}
                aria-label="Previous change (⇧N)"
                onClick={() => stepRegion(-1)}
              >
                ‹
              </Button>
              <span className={s.micro}>
                {regions.length
                  ? `change ${region < 0 ? '–' : region + 1} / ${regions.length}`
                  : 'no changes'}
              </span>
              <Button
                size="icon-sm"
                variant="outline"
                disabled={!regions.length}
                aria-label="Next change (N)"
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
            <div className={s.empty}>
              Render missing: {p.before} or {p.after}. Re-run the producer.
            </div>
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
            <div className={s.empty}>Loading renders…</div>
          )}
          {embedded ? null : (
            <div className={s.insHelp}>
              {[
                ['1–5', 'mode'],
                ['F', 'fit'],
                ['0', '1:1'],
                ['+ −', 'zoom'],
                ['N ⇧N', 'next / prev change'],
                ['← →', 'story'],
                ...(canReview
                  ? [
                      ['A', 'approve'],
                      ['R', 'reject'],
                    ]
                  : []),
                ...(embedded ? [] : [['Esc', 'close']]),
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
                <h4 className={s.sectionTitle}>View</h4>
                <div className={s.stack}>{viewControls}</div>
                {pixels ? (
                  <span className={s.row}>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      disabled={!regions.length}
                      aria-label="Previous change"
                      onClick={() => stepRegion(-1)}
                    >
                      ‹
                    </Button>
                    <span className={s.micro}>
                      {regions.length
                        ? `change ${region < 0 ? '–' : region + 1} / ${regions.length}`
                        : 'no changes'}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      disabled={!regions.length}
                      aria-label="Next change"
                      onClick={() => stepRegion(1)}
                    >
                      ›
                    </Button>
                  </span>
                ) : null}
              </section>
            ) : null}
            <section className={s.sideSection}>
              <h4 className={s.sectionTitle}>Pixel</h4>
              <div className={s.readout}>
                {!pixels ? (
                  <span className={s.muted}>
                    Pixel readout needs the local server: pxsig serve
                  </span>
                ) : !hover ? (
                  <span className={s.muted}>Hover the image to read pixels.</span>
                ) : (
                  <>
                    <div className={s.pxRow}>
                      <span className={s.mono}>
                        x {hover.ix} y {hover.iy}
                      </span>
                      <span className={`${s.mono} ${s.muted}`}>
                        cell {Math.floor(hover.ix / cw)},{Math.floor(hover.iy / chh)} · tile{' '}
                        {Math.floor(hover.ix / 16)},{Math.floor(hover.iy / 16)}
                      </span>
                    </div>
                    {(
                      [
                        ['before', hover.before],
                        ['after', hover.after],
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
                            : 'outside'}
                        </span>
                      </div>
                    ))}
                    <div className={s.pxRow}>
                      <span className={s.micro}>max channel Δ</span>
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
                <h4 className={s.sectionTitle}>Pixel changes</h4>
                <StaticList labelWidth="45%">
                  <StaticListItem label="Changed pixels">
                    <span className={s.mono}>
                      {fmt.num(analysis.changed)} (
                      {((analysis.changed / (W * H || 1)) * 100).toFixed(
                        analysis.changed && analysis.changed / (W * H) < 0.001 ? 3 : 2
                      )}
                      %)
                    </span>
                  </StaticListItem>
                  <StaticListItem label="Regions">
                    <span className={s.mono}>{regions.length}</span>
                  </StaticListItem>
                  <StaticListItem label="Max channel Δ">
                    <span className={s.mono}>{analysis.maxD}</span>
                  </StaticListItem>
                  <StaticListItem label="Size">
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
                      {analysis.changed ? '' : `No pixel differs by more than ${tol}.`}
                    </li>
                  )}
                </ol>
              </section>
            ) : null}

            {m ? (
              <section className={s.sideSection}>
                <h4 className={s.sectionTitle}>What pxsig measured</h4>
                <StaticList labelWidth="45%">
                  <StaticListItem label="SSIM">
                    <span className={s.mono}>{m.ssim}</span>{' '}
                    {m.ssim < 0.99 ? <Badge variant="destructive">&lt; 0.99</Badge> : null}
                  </StaticListItem>
                  <StaticListItem label={`Cells off by > ${m.threshold}`}>
                    <span className={s.mono}>
                      {m.changedCells} ({m.changedCellsPct}%)
                    </span>
                  </StaticListItem>
                  <StaticListItem label="Max cell Δ">
                    <span className={s.mono}>{m.maxCellDiff}</span>
                  </StaticListItem>
                  <StaticListItem label="Edge Δ">
                    <span className={s.mono}>{m.edgeDiffPct}%</span>
                  </StaticListItem>
                  {detail ? (
                    <>
                      <StaticListItem label="Detail tiles moved">
                        <span className={s.mono}>{detail.changedTiles}</span>{' '}
                        {detail.changedTiles + detail.newEdgeTiles >= 3 ? (
                          <Badge variant="destructive">≥ 3</Badge>
                        ) : null}
                      </StaticListItem>
                      <StaticListItem label="New edges">
                        <span className={s.mono}>{detail.newEdgeTiles}</span>
                      </StaticListItem>
                      <StaticListItem label="Max block Δ">
                        <span className={s.mono}>{detail.maxBlockDelta}</span>
                      </StaticListItem>
                    </>
                  ) : null}
                </StaticList>
                <div className={s.sigs}>
                  <figure>
                    <img src={p.baseSig} alt="Baseline signature" />
                    <figcaption className={s.micro}>baseline sig</figcaption>
                  </figure>
                  <figure>
                    <img src={p.curSig} alt="Current signature" />
                    <figcaption className={s.micro}>current sig</figcaption>
                  </figure>
                  <figure>
                    <img src={p.heat} alt="Cell heatmap" />
                    <figcaption className={s.micro}>cell heatmap</figcaption>
                  </figure>
                </div>
              </section>
            ) : null}

            {row.a11y?.violations?.length ? (
              <section className={s.sideSection}>
                <h4 className={s.sectionTitle}>Accessibility ({row.a11y.violations.length})</h4>
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
                        {v.id} · {v.nodes} node{v.nodes === 1 ? '' : 's'}
                      </span>
                      {row.a11y?.baseline && !row.a11y.baseline.includes(v.id) ? (
                        <Badge variant="destructive">new</Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className={s.sideSection}>
              <h4 className={s.sectionTitle}>Resources</h4>
              <ul className={s.resources}>
                {(
                  [
                    [p.beforeLabel, p.before],
                    [p.afterLabel, p.after],
                    ['baseline signature (png)', p.baseSig],
                    ['current signature (png)', p.curSig],
                    ['cell heatmap (png)', p.heat],
                    ['diff page (html)', p.page],
                    ...(p.record ? [['baseline record (json)', p.record]] : []),
                  ] as [string, string][]
                ).map(([label, url]) => (
                  <li key={label}>
                    <Link href={url} external className={s.grow}>
                      {label}
                    </Link>
                    <span className={`${s.mono} ${s.muted}`}>{sizes[url] ?? ''}</span>
                    <CopyValue value={repoPath(url)} hideValue label={`${label} path`} />
                  </li>
                ))}
                <li>
                  <Link href={sb} external className={s.grow}>
                    open story in Storybook
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
