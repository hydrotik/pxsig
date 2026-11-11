/**
 * An entry's mask badges, beside its verdict (inspector/Header.tsx, parts/StoryGrid.tsx): Masks
 * changed when its masks differ from the baseline's, Large mask when a mask covers over 25% of
 * the capture (a warning, never a verdict). Nothing for an entry without either.
 */
import { Badge } from '@ui';
import { t } from '../copy';
import type { Row } from '../data';

export function MaskBadges({ row }: { row: Row }) {
  const large = row.masksLarge ?? [];
  return (
    <>
      {row.masksChanged ? <Badge tone="warning">{t('review.card.masksChanged')}</Badge> : null}
      {large.length ? (
        <Badge
          tone="warning"
          title={t('review.card.largeMaskTitle', {
            count: large.length,
            selectors: large.map((m) => m.selector).join(', '),
          })}
        >
          {t('review.card.largeMask')}
        </Badge>
      ) : null}
    </>
  );
}
