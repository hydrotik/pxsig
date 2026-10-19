/**
 * A simplified drawing of the dashboard or the inspector, for the Help tab: each region the help
 * text names is a box, and the regions in `active` are highlighted.
 */
import { vars } from '@hydrotik/tokens';
import { t, type CopyKey } from '../copy';
import * as s from '../dashboard.css';

export type Layout = 'dashboard' | 'inspector';
type Box = [x: number, y: number, w: number, h: number];

/** Regions per layout. A region with a label draws its name inside it. */
const REGIONS: Record<Layout, Record<string, { box: Box; label?: CopyKey }>> = {
  dashboard: {
    header: { box: [0, 0, 320, 18] },
    'review-button': { box: [196, 4, 54, 10], label: 'help.schematic.reviewButton' },
    'header-status': { box: [256, 4, 58, 10], label: 'help.schematic.status' },
    'tab-overview': { box: [6, 24, 34, 11], label: 'tabs.overview' },
    'tab-review': { box: [42, 24, 56, 11], label: 'tabs.review' },
    'tab-coverage': { box: [100, 24, 38, 11], label: 'tabs.coverage' },
    'tab-a11y': { box: [140, 24, 48, 11], label: 'tabs.a11y' },
    'tab-runs': { box: [190, 24, 26, 11], label: 'tabs.runs' },
    'tab-help': { box: [218, 24, 26, 11], label: 'tabs.help' },
    cards: { box: [6, 41, 308, 22], label: 'help.schematic.cards' },
    'open-items': { box: [6, 68, 308, 40], label: 'help.schematic.openItems' },
    'card-edge': { box: [6, 114, 3, 80] },
    'card-thumb': { box: [9, 114, 92, 50] },
    'card-status': { box: [12, 170, 40, 9], label: 'help.schematic.badge' },
    'card-flags': { box: [55, 170, 42, 9], label: 'help.schematic.flags' },
    'card-stats': { box: [12, 183, 85, 7] },
    card2: { box: [110, 114, 95, 80] },
    card3: { box: [214, 114, 100, 80] },
  },
  inspector: {
    session: { box: [0, 0, 320, 10], label: 'help.schematic.progress' },
    'ins-title': { box: [6, 13, 96, 11], label: 'help.schematic.entry' },
    'ins-status': { box: [150, 14, 30, 9], label: 'help.schematic.status' },
    'ins-storynav': { box: [184, 14, 30, 9], label: 'help.schematic.storyNav' },
    'ins-review': { box: [218, 14, 70, 9], label: 'help.schematic.review' },
    'ins-close': { box: [292, 14, 24, 9], label: 'inspector.close' },
    'ins-note': { box: [0, 27, 320, 8], label: 'help.schematic.note' },
    'ins-modes': { box: [6, 39, 96, 9], label: 'help.schematic.modes' },
    'ins-zoom': { box: [106, 39, 50, 9], label: 'help.schematic.zoom' },
    'ins-view': { box: [160, 39, 60, 9], label: 'help.schematic.view' },
    'ins-changenav': { box: [262, 39, 52, 9], label: 'help.schematic.changes' },
    'ins-stage': { box: [6, 54, 212, 128], label: 'help.schematic.stage' },
    'ins-keys': { box: [6, 186, 212, 9], label: 'help.schematic.keys' },
    'ins-pixel': { box: [224, 54, 90, 20], label: 'inspector.sections.pixel' },
    'ins-changes': { box: [224, 77, 90, 22], label: 'inspector.sections.changes' },
    'ins-metrics': { box: [224, 102, 90, 26], label: 'inspector.sections.metrics' },
    'ins-sigs': { box: [224, 131, 90, 15], label: 'help.schematic.sigs' },
    'ins-a11y': { box: [224, 149, 90, 18], label: 'tabs.a11y' },
    'ins-files': { box: [224, 170, 90, 25], label: 'inspector.sections.files' },
  },
};

export function Schematic({ layout, active }: { layout: Layout; active: string[] }) {
  const on = new Set(active);
  return (
    <svg className={s.schematic} viewBox="0 0 320 200" role="img" aria-label={t(`help.schematic.${layout}`)}>
      <rect x={0.5} y={0.5} width={319} height={199} rx={4} style={{ fill: vars.color.background, stroke: vars.color.border }} />
      {Object.entries(REGIONS[layout]).map(([id, r]) => {
        const [x, y, w, h] = r.box;
        const hot = on.has(id);
        return (
          <g key={id} data-region={id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={2}
              style={{
                fill: hot ? `color-mix(in srgb, ${vars.color.primary} 22%, transparent)` : vars.color.surface,
                stroke: hot ? vars.color.primary : vars.color.border,
                strokeWidth: hot ? 1.5 : 0.75,
                transition: 'fill 120ms, stroke 120ms',
              }}
            />
            {r.label && h >= 8 ? (
              <text x={x + 3} y={y + Math.min(h - 2.5, 7)} style={{ fill: hot ? vars.color.text : vars.color.textMuted, fontSize: 5.5, fontFamily: vars.font.family.sans }}>
                {t(r.label)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
