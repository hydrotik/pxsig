/** The inspector's Pixel section (Inspector.tsx): the pixel under the pointer, a Storybook link. */
import { Badge, Button, Icon } from '@ui';
import { Cmd, t, tx } from '../../copy';
import * as s from '../../dashboard.css';
import { DiffViewer } from '../../diff-viewer';
import type { storybookLink } from '../../storybook-link.mjs';
import type { Row } from '../../data';
import { hex } from '../analyse';
import type { Loaded } from '../Inspector';
import type { Probe } from '../Stage';

export function PixelSection({
  embedded,
  sb,
  sbLink,
  loaded,
  pixels,
  W,
  H,
  m,
  tol,
}: {
  embedded: boolean;
  sb: ReturnType<typeof storybookLink>['url'];
  sbLink: ReturnType<typeof storybookLink>;
  loaded: Loaded | null | 'missing';
  pixels: Loaded | null;
  W: number;
  H: number;
  m: Row['metrics'];
  tol: number;
}) {
  const cw = W / (m?.grid ?? 64);
  const chh = H / (m?.grid ?? 64);
  const dmaxOf = (hover: Probe | null) =>
    hover?.baseline && hover.latest
      ? Math.max(...hover.baseline.map((v, i) => Math.abs(v - hover.latest![i])))
      : 255;
  return (
    <section className={s.sideSection}>
      <div className={s.sectionHead}>
        <h3 className={s.sectionTitle}>{t('inspector.sections.pixel')}</h3>
        {embedded ? null : (
          <Button
            href={sb}
            external
            size="sm"
            emphasis="outline"
            title={
              sbLink.globals
                ? t('inspector.storybook.title', { globals: sbLink.globals })
                : t('inspector.storybook.titlePlain')
            }
          >
            {t('inspector.storybook.open')}
            <Icon name="external" size="1em" />
          </Button>
        )}
      </div>
      <div className={s.readout}>
        {loaded && loaded !== 'missing' && !loaded.a ? (
          <span className={s.muted}>{t('inspector.pixel.noBaseline')}</span>
        ) : !pixels ? (
          <span className={s.muted}>
            {tx('inspector.pixel.needsServer', { command: <Cmd>pxsig serve</Cmd> })}
          </span>
        ) : (
          // The same rows with or without a pointer, so the panel never changes height.
          <DiffViewer.Probe>
            {(probe) => {
              const hover = probe && {
                ix: probe.x,
                iy: probe.y,
                before: probe.baseline,
                after: probe.latest,
              };
              const dmax = dmaxOf(probe);
              const where = hover
                ? t('inspector.pixel.cellTile', {
                    cx: Math.floor(hover.ix / cw),
                    cy: Math.floor(hover.iy / chh),
                    tx: Math.floor(hover.ix / 16),
                    ty: Math.floor(hover.iy / 16),
                  })
                : undefined;
              return (
                <>
                  <div className={s.pxRow}>
                    {hover ? (
                      <>
                        <span className={`${s.mono} ${s.pxCoords}`}>
                          {t('inspector.pixel.coords', { x: hover.ix, y: hover.iy })}
                        </span>
                        {/* One line, so the row keeps its height: the title holds what it cuts. */}
                        <span className={`${s.mono} ${s.muted} ${s.oneLine}`} title={where}>
                          {where}
                        </span>
                      </>
                    ) : (
                      <span
                        className={`${s.muted} ${s.oneLine}`}
                        title={t('inspector.pixel.hover')}
                      >
                        {t('inspector.pixel.hover')}
                      </span>
                    )}
                  </div>
                  {(
                    [
                      [t('inspector.pixel.before'), hover?.before],
                      [t('inspector.pixel.after'), hover?.after],
                    ] as const
                  ).map(([label, v]) => (
                    <div className={s.pxRow} key={label}>
                      <span
                        className={s.swatch}
                        style={
                          v
                            ? {
                                background: `rgba(${v[0]},${v[1]},${v[2]},${v[3] / 255})`,
                              }
                            : undefined
                        }
                      />
                      <span className={s.micro} style={{ minInlineSize: '4rem' }}>
                        {label}
                      </span>
                      <span className={s.mono}>
                        {!hover
                          ? '—'
                          : v
                            ? `${hex(v[0], v[1], v[2])}${v[3] < 255 ? ` α${v[3]}` : ''}`
                            : t('inspector.pixel.outside')}
                      </span>
                    </div>
                  ))}
                  <div className={s.pxRow}>
                    <span className={s.micro}>{t('inspector.pixel.maxDelta')}</span>
                    {!hover ? (
                      <span className={s.mono}>—</span>
                    ) : dmax > tol ? (
                      <Badge tone="danger">{dmax}</Badge>
                    ) : (
                      <span className={s.mono}>{dmax}</span>
                    )}
                  </div>
                </>
              );
            }}
          </DiffViewer.Probe>
        )}
      </div>
    </section>
  );
}
