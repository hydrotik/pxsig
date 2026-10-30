/** The inspector's Metrics section (Inspector.tsx): the signature metrics and images. */
import { Badge, KeyValueItem, KeyValueList } from '@ui';
import { t } from '../../copy';
import * as s from '../../dashboard.css';
import type { Row, pathsFor } from '../../data';

export function MetricsSection({
  m,
  detail,
  hasArtifacts,
  p,
}: {
  m: NonNullable<Row['metrics']>;
  detail: Row['detail'];
  hasArtifacts: boolean;
  p: NonNullable<ReturnType<typeof pathsFor>>;
}) {
  return (
    <section className={s.sideSection}>
      <h3 className={s.sectionTitle}>{t('inspector.sections.metrics')}</h3>
      <KeyValueList labelWidth="45%">
        <KeyValueItem label={t('inspector.metrics.ssim')}>
          <span className={s.mono}>{m.ssim}</span>{' '}
          {m.ssim < 0.99 ? <Badge tone="danger">&lt; 0.99</Badge> : null}
        </KeyValueItem>
        <KeyValueItem label={t('inspector.metrics.cellsOver', { threshold: m.threshold })}>
          <span className={s.mono}>
            {m.changedCells} ({m.changedCellsPct}%)
          </span>
        </KeyValueItem>
        <KeyValueItem label={t('inspector.metrics.maxCell')}>
          <span className={s.mono}>{m.maxCellDiff}</span>
        </KeyValueItem>
        <KeyValueItem label={t('inspector.metrics.edge')}>
          <span className={s.mono}>{m.edgeDiffPct}%</span>
        </KeyValueItem>
        {detail ? (
          <>
            <KeyValueItem label={t('inspector.metrics.tilesChanged')}>
              <span className={s.mono}>{detail.changedTiles}</span>{' '}
              {detail.changedTiles + detail.newEdgeTiles >= 3 ? (
                <Badge tone="danger">≥ 3</Badge>
              ) : null}
            </KeyValueItem>
            <KeyValueItem label={t('inspector.metrics.newEdges')}>
              <span className={s.mono}>{detail.newEdgeTiles}</span>
            </KeyValueItem>
            <KeyValueItem label={t('inspector.metrics.maxBlock')}>
              <span className={s.mono}>{detail.maxBlockDelta}</span>
            </KeyValueItem>
          </>
        ) : null}
      </KeyValueList>
      {hasArtifacts ? (
        <div className={s.sigs}>
          <figure>
            <img src={p.baseSig} alt={t('inspector.metrics.baseSig')} />
            <figcaption className={s.micro}>{t('inspector.metrics.baseSig')}</figcaption>
          </figure>
          <figure>
            <img src={p.curSig} alt={t('inspector.metrics.curSig')} />
            <figcaption className={s.micro}>{t('inspector.metrics.curSig')}</figcaption>
          </figure>
          <figure>
            <img src={p.heat} alt={t('inspector.metrics.heatmap')} />
            <figcaption className={s.micro}>{t('inspector.metrics.heatmap')}</figcaption>
          </figure>
        </div>
      ) : (
        <span className={s.muted}>{t('inspector.artifacts.notWritten')}</span>
      )}
    </section>
  );
}
