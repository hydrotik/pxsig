/**
 * The inspector's Changes section (Inspector.tsx): the Tolerance that decides which pixels count as
 * changed (disabled while Originals is on), changed pixels, the size, the regions. A detail-only
 * change (detailOnly.ts) lists its detail tiles in the regions' place and says why.
 */
import { KeyValueItem, KeyValueList, Slider } from '@ui';
import { t } from '../../copy';
import * as s from '../../dashboard.css';
import { fmt } from '../../data';
import type { Analysis } from '../analyse';
import type { Loaded } from '../Inspector';

export function ChangesSection({
  analysis,
  loaded,
  W,
  H,
  regions,
  region,
  focusRegion,
  tol,
  setTol,
  originals,
  detailOnly,
}: {
  analysis: Analysis;
  loaded: Loaded | null | 'missing';
  W: number;
  H: number;
  regions: Analysis['regions'];
  region: number;
  focusRegion: (i: number) => void;
  tol: number;
  setTol: (v: number) => void;
  originals: boolean;
  /** The detail channel's change, under the tolerance: `regions` are its tiles. */
  detailOnly: boolean;
}) {
  const sizeNote =
    loaded &&
    loaded !== 'missing' &&
    loaded.a &&
    (loaded.a.naturalWidth !== loaded.b.naturalWidth ||
      loaded.a.naturalHeight !== loaded.b.naturalHeight)
      ? `${loaded.a.naturalWidth}×${loaded.a.naturalHeight} → ${loaded.b.naturalWidth}×${loaded.b.naturalHeight}`
      : `${W}×${H}`;
  return (
    <section className={s.sideSection}>
      <h3 className={s.sectionTitle}>{t('inspector.sections.changes')}</h3>
      <Slider
        className={s.sliderCtl}
        label={t('inspector.sliders.tolerance')}
        value={tol}
        max={96}
        onValueChange={setTol}
        disabled={originals}
      />
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
          <span className={s.mono}>{analysis.regions.length}</span>
        </KeyValueItem>
        <KeyValueItem label={t('inspector.changes.maxDelta')}>
          <span className={s.mono}>{analysis.maxD}</span>
        </KeyValueItem>
        <KeyValueItem label={t('inspector.changes.size')}>
          <span className={s.mono}>{sizeNote}</span>
        </KeyValueItem>
      </KeyValueList>
      {detailOnly ? (
        <span className={s.muted}>
          {t('inspector.changes.detailOnly', { count: regions.length, tol })}
        </span>
      ) : null}
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
                <span className={s.muted}>
                  {detailOnly ? t('inspector.changes.tile') : `${fmt.num(r.px)} px`}
                </span>
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
  );
}
