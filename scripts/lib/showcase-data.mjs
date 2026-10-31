/**
 * showcase-data.mjs — the mock project scripts/showcase-shots.mjs serves: what `/__pxsig/data`
 * would return for a design system in the middle of a review. Built with the dashboard's own
 * fixture builders (packages/dashboard/fixtures/scenarios.mjs), so it keeps their shape.
 *
 * 21 stories in two modes (42 entries) over nine components: 6 changed, 2 new, 2 render errors,
 * 2 stories without coverage, one new accessibility violation, stale entries in four components and
 * 14 runs of history. Neutral names only; fixed timestamps, so two runs serve the same JSON.
 */
import {
  AT,
  data,
  inComponent,
  row,
  spread,
} from '../../packages/dashboard/fixtures/scenarios.mjs';

/** The project's label in the header (`pxsig • <label>`). */
export const LABEL = 'example ds';

/** Component → its stories (the part after `<component>--`). */
const STORIES = {
  Avatar: ['default', 'group'],
  Badge: ['default', 'success', 'warning', 'destructive'],
  Button: ['primary', 'secondary', 'ghost', 'disabled'],
  Card: ['default', 'with-footer'],
  ProjectCard: ['compact', 'default', 'with-owners'],
  Select: ['default', 'grouped'],
  Input: ['default', 'invalid'],
  Tooltip: ['default'],
  Toolbar: ['default'],
};
/** The changed story the review opens on (the first in id order). */
export const FIRST_CHANGE = 'components-projectcard--compact';
const CHANGED = new Set([
  FIRST_CHANGE,
  'components-projectcard--default',
  'components-projectcard--with-owners',
]);
const NEW = new Set(['components-toolbar--default']);
const BROKEN = new Set(['components-select--grouped']);
/** Stale entries per component: the heatmap's share, highest first. */
const STALE = { Badge: 8, Avatar: 4, Button: 4, Input: 2 };
const A11Y = 'components-badge--warning';

/** @type {(component: string) => string} */
const slug = (c) => c.toLowerCase();
/** The light entry is the bare story id; the dark one carries `@dark`, as in a real store. */
const MODES = /** @type {const} */ (['light', 'dark']);
/** @type {(story: string, mode: string) => string} */
const idOf = (story, mode) => (mode === 'light' ? story : `${story}@${mode}`);

/**
 * The gate's verdict on a changed entry, with the numbers the inspector shows.
 * @param {{ width: number, height: number, baseHeight: number, regions: { x: number, y: number, w: number, h: number, px: number }[] }} px
 */
const changedRow = (px) => {
  const changed = px.regions.reduce((n, r) => n + r.px, 0);
  return {
    pass: false,
    changed: true,
    gate: { threshold: 24, minSsim: 0.99, maxChangedPct: 2, minCells: 3 },
    metrics: {
      ssim: 0.6414,
      matchScore: 64.14,
      colorDiffPct: 6.2,
      edgeDiffPct: 5.401,
      maxCellDiff: 182,
      changedCells: 361,
      changedCellsPct: 11.93,
      psnr: 19.2,
      identical: false,
      grid: 64,
      threshold: 24,
    },
    reasons: [
      'ssim 0.6414 < min 0.99',
      'changedCellsPct 11.93 > max 2',
      'changedCells 361 >= 3 (off by > 24)',
      'detail 50 tiles changed (33 kept, 17 new edges) >= 3',
    ],
    detail: { changedTiles: 50, newEdgeTiles: 17, maxBlockDelta: 171, tripped: [] },
    pixels: {
      width: px.width,
      height: px.height,
      changed,
      maxDelta: 255,
      tolerance: 16,
      regions: px.regions,
      regionCount: px.regions.length,
    },
  };
};

/**
 * The served data. `pixels` describes the sample images (their size and changed regions).
 * @param {Parameters<typeof changedRow>[0]} pixels
 */
export function showcaseData(pixels) {
  /** @type {ReturnType<typeof row>[]} */
  const rows = [];
  /** @type {ReturnType<typeof inComponent>[]} */
  const entries = [];
  /** @type {Record<string, number>} */
  const staleLeft = { ...STALE };
  for (const [component, names] of Object.entries(STORIES))
    for (const name of names) {
      const story = `components-${slug(component)}--${name}`;
      for (const mode of MODES) {
        const id = idOf(story, mode);
        /** @type {Record<string, unknown>} */
        let extra = { story, mode };
        /** @type {{ code: string, severity: string, reason: string }[]} */
        const issues = [];
        if (CHANGED.has(story)) {
          extra = { ...extra, ...changedRow(pixels) };
          issues.push({ code: 'changed', severity: 'warn', reason: 'gate failed' });
        } else if (NEW.has(story)) {
          extra = { ...extra, pass: false, new: true, metrics: null, reasons: ['new'] };
          issues.push({ code: 'unbaselined', severity: 'warn', reason: 'no signature' });
        } else if (BROKEN.has(story)) {
          extra = {
            ...extra,
            pass: false,
            metrics: null,
            error: 'storybook-error: Storybook error page (Select: options is undefined)',
          };
          issues.push({ code: 'render-error', severity: 'error', reason: 'Storybook error page' });
        }
        if (story === A11Y && mode === 'dark') {
          const v = {
            id: 'color-contrast',
            impact: 'serious',
            help: 'Elements must meet minimum color contrast ratio thresholds',
            nodes: 1,
            targets: ['.badge-label'],
          };
          extra.a11y = { violations: [v], new: 1, baseline: [] };
          issues.push({ code: 'a11y-new', severity: 'warn', reason: 'color-contrast is new' });
        }
        if ((staleLeft[component] ?? 0) > 0 && !issues.length) {
          staleLeft[component]--;
          issues.push({
            code: 'stale',
            severity: 'warn',
            reason: 'source edited after the verdict',
          });
        }
        rows.push(row(id, extra));
        entries.push(inComponent(component, id, issues));
      }
    }
  // Two stories in the story index that nothing checks: coverage errors, without a row.
  for (const [component, story] of [
    ['Avatar', 'components-avatar--with-status'],
    ['Tooltip', 'components-tooltip--long-text'],
  ])
    entries.push(
      inComponent(component, story, [
        { code: 'unregistered', severity: 'error', reason: 'in the story index, not the manifest' },
      ])
    );

  const d = spread(
    data({
      rows,
      entries,
      summary: {
        changed: 6,
        new: 2,
        a11yViolations: 1,
        a11yNew: 1,
        renderWallMs: 4400,
        totalMs: 4400,
      },
    })
  );
  d.history = [0, 10, 0, 0, 4, 0, 2, 8, 2, 12, 10, 16, 6, 10].map((failed, i) => ({
    at: new Date(Date.parse(AT) - (13 - i) * 36e5).toISOString(),
    summary: { stories: 42, failed, cached: 0, elapsedMs: 4400 },
    failedIds: [],
  }));
  return { ...d, project: 'design-system', label: LABEL };
}
