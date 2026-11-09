/**
 * The inspector's Text section (side/Side.tsx, after Pixel Changes, before Metrics): a row's text
 * labels (`textDiff`). The summary, then each change as a button that shows its box on the stage
 * as a region does, a space shown as `␠`; or why nothing was compared (no text record in the
 * baseline, another environment, a record not read), or that no text changed. Labels only: the
 * gate, the verdict and the decision are the same without it.
 */
import React from 'react';
import { t } from '../../copy';
import * as s from '../../dashboard.css';
import type { Row } from '../../data';
import { sayChange, textSummary } from '../textSay';

/** Room around a change's box when the stage shows it, px. */
const PAD = 8;

const mono = (q: string) => <span className={s.mono}>{q}</span>;

export function TextSection({
  row,
  focusBox,
}: {
  row: Row;
  /** Show a box on the stage, as a region is shown. */
  focusBox: (r: { x: number; y: number; w: number; h: number }) => void;
}) {
  const [active, setActive] = React.useState(-1);
  const d = row.textDiff;
  if (!d) return null;
  const listed = d.state === 'compared' && d.changeCount > 0 ? d.changes : [];
  const more = d.state === 'compared' ? d.changeCount - d.changes.length : 0;
  const show = (i: number) => {
    const [x, y, w, h] = listed[i].box;
    const x0 = Math.max(0, Math.floor(x) - PAD);
    const y0 = Math.max(0, Math.floor(y) - PAD);
    setActive(i);
    focusBox({ x: x0, y: y0, w: Math.ceil(x + w) + PAD - x0, h: Math.ceil(y + h) + PAD - y0 });
  };
  return (
    <section className={s.sideSection}>
      <h3 className={s.sectionTitle}>{t('inspector.sections.text')}</h3>
      <p className={`${s.small} ${listed.length ? '' : s.muted}`} style={{ margin: 0 }}>
        {textSummary(d)}
      </p>
      {listed.length ? (
        <ol className={s.regions} aria-label={t('inspector.text.changesLabel')}>
          {listed.map((c, i) => (
            <li key={i}>
              <button
                type="button"
                className={s.textChange}
                aria-pressed={i === active}
                onClick={() => show(i)}
              >
                {sayChange(c, listed, mono)}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {more > 0 ? (
        <span className={s.small}>{t('inspector.text.more', { count: more })}</span>
      ) : null}
      {d.state === 'compared' && d.truncated ? (
        <span className={s.small}>{t('inspector.text.truncated')}</span>
      ) : null}
      <span className={`${s.small} ${s.muted}`}>{t('inspector.text.labelOnly')}</span>
    </section>
  );
}
