/**
 * An entry's mask badges, beside its verdict (inspector/Header.tsx, parts/StoryGrid.tsx): Masks
 * changed when its masks differ from the baseline's, Large mask when all of its masks together
 * cover over 25% of the capture (a warning, never a verdict), its title naming them. Nothing for
 * an entry without either.
 */
import { Badge } from '@ui';
import { t } from '../copy';
import { fmt, type Row } from '../data';
import { masksLarge } from '../inspector/masks';

export function MaskBadges({ row }: { row: Row }) {
  const masks = row.masks ?? [];
  return (
    <>
      {row.masksChanged ? <Badge tone="warning">{t('review.card.masksChanged')}</Badge> : null}
      {masksLarge(row) ? (
        <Badge
          tone="warning"
          title={t('review.card.largeMaskTitle', {
            count: masks.length,
            share: fmt.pct(row.masksCoverage ?? 0, 0),
            selectors: masks.map((m) => m.selector).join(', '),
          })}
        >
          {t('review.card.largeMask')}
        </Badge>
      ) : null}
    </>
  );
}
