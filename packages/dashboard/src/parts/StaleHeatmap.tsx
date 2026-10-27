/**
 * Stale entries by component, as a heatmap (Coverage, and the Overview's left column). A verdict is
 * stale when a source the entry depends on changed after it, or its render was rewritten after it
 * (the `stale` code of the integrity ledger). One tile per component with a stale entry: its share
 * of the component's entries is the colour, the count is on the tile, the worst share first.
 */
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Heatmap } from '@ui';
import type { Data } from '../data';
import { t } from '../copy';
import * as s from '../dashboard.css';

export interface StaleComponent {
  component: string;
  stale: number;
  entries: number;
}

/** Components with at least one stale entry, the highest share first (then the most stale, then by name). */
export function staleByComponent(L: Data['integrity']): StaleComponent[] {
  if (!L) return [];
  const stale = new Map<string, number>();
  for (const x of L.entries)
    if (x.issues.some((i) => i.code === 'stale'))
      stale.set(x.component, (stale.get(x.component) ?? 0) + 1);
  const totals = new Map(L.components.map((c) => [c.component, c.entries]));
  return [...stale]
    .map(([component, n]) => ({
      component,
      stale: n,
      entries: Math.max(n, totals.get(component) ?? n),
    }))
    .sort(
      (a, b) =>
        b.stale / b.entries - a.stale / a.entries ||
        b.stale - a.stale ||
        a.component.localeCompare(b.component)
    );
}

/**
 * The heatmap in a card. `limit` shows the first tiles only, with a way to the rest (`onViewAll`);
 * a tile calls `onSelect` with its component.
 */
export function StaleHeatmap({
  data,
  onSelect,
  limit,
  onViewAll,
}: {
  data: Data;
  onSelect(component: string): void;
  limit?: number;
  onViewAll?(): void;
}) {
  const L = data.integrity;
  if (!L) return null;
  const all = staleByComponent(L);
  const shown = limit ? all.slice(0, limit) : all;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('coverage.stale.title')}</CardTitle>
        {all.length ? (
          <CardDescription>
            {t('coverage.stale.description', { count: all.length, total: L.components.length })}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        {all.length ? (
          <div className={s.stack}>
            <Heatmap
              label={t('coverage.stale.label')}
              legend={{
                label: t('coverage.stale.legend'),
                low: t('coverage.stale.low'),
                high: t('coverage.stale.high'),
              }}
              cells={shown.map((c) => ({
                id: c.component,
                label: c.component,
                value: c.stale / c.entries,
                text: t('coverage.stale.tile', { count: c.stale, total: c.entries }),
                accessibleLabel: t('coverage.stale.tileLabel', {
                  component: c.component,
                  count: c.stale,
                  total: c.entries,
                }),
              }))}
              onSelect={(c) => onSelect(c.id)}
            />
            {onViewAll && all.length > shown.length ? (
              <span className={s.row}>
                <Button size="sm" emphasis="outline" onClick={onViewAll}>
                  {t('coverage.stale.viewAll', { count: all.length })}
                </Button>
              </span>
            ) : null}
          </div>
        ) : (
          <div className={s.empty}>{t('coverage.stale.none')}</div>
        )}
      </CardContent>
    </Card>
  );
}
