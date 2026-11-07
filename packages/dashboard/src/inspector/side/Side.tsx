/**
 * The inspector's side panel (Inspector.tsx): its sections in order. View (in the Storybook panel
 * only), Pixel, Pixel Changes, Metrics, Accessibility, React (not in the panel) and Files, each shown as Inspector.tsx
 * decides from what it computed; nothing is computed here.
 */
import * as s from '../../dashboard.css';
import type { Analysis } from '../analyse';
import { A11ySection } from './A11ySection';
import { ChangesSection } from './ChangesSection';
import { FilesSection } from './FilesSection';
import { MetricsSection } from './MetricsSection';
import { PixelSection } from './PixelSection';
import { ReactSection } from './ReactSection';
import { ViewSection } from './ViewSection';

/** A section's props. */
type P<T extends (props: never) => unknown> = Parameters<T>[0];

/** What the sections take, from Inspector.tsx (`analysis` and `m` may be missing). */
export type SideProps = P<typeof PixelSection> &
  Omit<P<typeof ViewSection>, 'pixels'> &
  Omit<P<typeof ChangesSection>, 'analysis' | 'loaded' | 'W' | 'H' | 'tol' | 'regions' | 'region'> &
  Omit<P<typeof MetricsSection>, 'm'> &
  P<typeof A11ySection> &
  Omit<P<typeof FilesSection>, 'sb'> &
  Pick<P<typeof ReactSection>, 'onGo'> & { analysis: Analysis | null };

export function InspectorSide({
  embedded,
  viewControls,
  pixels,
  regions,
  region,
  stepRegion,
  sb,
  sbLink,
  loaded,
  W,
  H,
  m,
  tol,
  analysis,
  focusRegion,
  setTol,
  originals,
  detail,
  hasArtifacts,
  p,
  row,
  newA11y,
  target,
  canReview,
  busy,
  unaccept,
  a11yMode,
  a11yDecision,
  act,
  data,
  sizes,
  onGo,
}: SideProps) {
  return (
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
          setTol={setTol}
          originals={originals}
        />
      ) : null}

      {m ? <MetricsSection m={m} detail={detail} hasArtifacts={hasArtifacts} p={p} /> : null}

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

      {embedded ? null : <ReactSection data={data} row={row} onGo={onGo} />}

      <FilesSection data={data} p={p} hasArtifacts={hasArtifacts} sizes={sizes} sb={sb} />
    </aside>
  );
}
