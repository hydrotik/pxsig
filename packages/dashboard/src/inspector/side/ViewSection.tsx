/** The inspector's View section (Inspector.tsx), embedded only: view controls, change arrows. */
import type { ReactNode } from 'react';
import { IconButton } from '@ui';
import { t } from '../../copy';
import * as s from '../../dashboard.css';
import type { Analysis } from '../analyse';
import type { Loaded } from '../Inspector';

export function ViewSection({
  viewControls,
  pixels,
  regions,
  region,
  stepRegion,
}: {
  viewControls: ReactNode;
  pixels: Loaded | null;
  regions: Analysis['regions'];
  region: number;
  stepRegion: (d: number) => unknown;
}) {
  return (
    <section className={s.sideSection}>
      <h3 className={s.sectionTitle}>{t('inspector.sections.view')}</h3>
      <div className={s.stack}>{viewControls}</div>
      {pixels ? (
        <span className={s.row}>
          <IconButton
            size="sm"
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
            size="sm"
            emphasis="outline"
            disabled={!regions.length}
            label={t('inspector.nav.nextChange')}
            onClick={() => stepRegion(1)}
          >
            ›
          </IconButton>
        </span>
      ) : null}
    </section>
  );
}
