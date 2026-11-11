/**
 * The inspector's Masks section (side/Side.tsx): the masks on the render (masks.ts), one item
 * each: how it compares with the baseline (Added, Removed, Grew, Count changed, Moved) and Over 25%
 * for a large one, the selector, then where it came from, its reason and its share of the capture
 * (the baseline's and the render's when the masks changed). Masks no approval passes say so first.
 * After Pixel Changes; first when the change is masks-only.
 */
import { Badge } from '@ui';
import { t } from '../../copy';
import * as s from '../../dashboard.css';
import { fmt, type Row } from '../../data';
import { blockedReasons, changedMasks, maskLines } from '../masks';

/** A share of the capture, with one decimal under 10%. */
const share = (v: number | null) =>
  v == null ? t('inspector.masks.absent') : fmt.pct(v, v < 0.1 ? 1 : 0);

export function MasksSection({ row }: { row: Row }) {
  const lines = maskLines(row);
  if (!lines.length) return null;
  const ch = row.masksChanged;
  const changed = changedMasks(row);
  const blocked = blockedReasons(row);
  return (
    <section className={s.sideSection}>
      <h3 className={s.sectionTitle}>{t('inspector.sections.masks')}</h3>
      {blocked.length ? (
        <span className={s.small}>
          {t('inspector.masks.blocked', { reasons: blocked.join('; ') })}
        </span>
      ) : null}
      {changed ? (
        <span className={s.small}>{t('inspector.masks.changed', { count: changed })}</span>
      ) : null}
      <ul className={`${s.resources} ${s.maskList}`} aria-label={t('inspector.masks.label')}>
        {lines.map((m) => (
          <li key={m.selector} className={s.a11yItem}>
            {m.state === 'same' ? null : (
              <Badge tone="warning">{t(`inspector.masks.${m.state}`)}</Badge>
            )}
            {m.large ? <Badge tone="warning">{t('inspector.masks.large')}</Badge> : null}
            <span className={`${s.a11yRule} ${s.mono} ${s.maskMeta}`} title={m.selector}>
              {m.selector}
            </span>
            <span className={`${s.small} ${s.muted} ${s.maskMeta}`}>
              {[
                t(`inspector.masks.source.${m.source}`),
                m.reason,
                ch
                  ? t('inspector.masks.areas', { before: share(m.before), after: share(m.after) })
                  : t('inspector.masks.area', { area: share(m.after) }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
