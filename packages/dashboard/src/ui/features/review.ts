/** The review, coverage, a11y, runs, diagnostics and help features (features.ts). */
import type { Feature } from '../features.ts';

export const REVIEW: Feature[] = [
  {
    id: 'review.filters',
    section: 'review',
    title: 'Review filters',
    purpose:
      'Search by entry id, filter by result and mode, sort, and group by component; the count of shown entries sits on the same line.',
    states: { empty: 'Without a check: the command that runs one.' },
    interactions: [{ action: 'Search, filter, sort, group' }],
    copy: [
      'review.fields',
      'review.filters',
      'review.sort',
      'review.group',
      'review.count',
      'review.search',
    ],
    components: [
      'Toolbar',
      'ToolbarStart',
      'ToolbarEnd',
      'ToolbarField',
      'ToolbarSummary',
      'SearchField',
      'Select',
    ],
    files: ['views/Stories'],
    screens: [
      { scenario: 'changed', hash: '#stories', wait: { role: 'heading', name: 'Review Stories' } },
    ],
    anchors: [
      { name: 'story-search', target: { role: 'searchbox', name: 'Story' } },
      { name: 'group', target: { role: 'combobox', name: 'Group' } },
    ],
  },
  {
    id: 'review.cards',
    section: 'review',
    title: 'Story cards',
    purpose:
      'One card per entry: thumbnail, verdict, mode and state tags, accessibility and coverage flags, metrics; a coloured edge per verdict. Grouped by component, paged.',
    states: { empty: 'A line saying no entry matches.' },
    interactions: [{ action: 'Open the inspector on an entry' }, { action: 'Show more' }],
    copy: ['review.card', 'review.none', 'review.showMore', 'status'],
    components: ['Badge', 'StatusBadge', 'Button'],
    files: ['parts/StoryGrid', 'parts/StatusOf'],
    screens: [
      { scenario: 'changed', hash: '#stories', wait: { role: 'region', name: 'Button' } },
      { scenario: 'flaky', hash: '#stories', wait: { role: 'region', name: 'Button' } },
    ],
  },
  {
    id: 'coverage.ledger',
    section: 'coverage',
    title: 'Coverage ledger',
    purpose:
      'Whether every story is registered, rendered, checked and current, per component, with counts that filter the table, stale entries by component as a heatmap, and the entries of a chosen component.',
    states: { empty: 'Without integrity data: the commands that produce it.' },
    interactions: [
      { action: 'Filter by an issue count' },
      { action: 'Show components with issues, or all' },
      {
        action:
          'Open a component from the table or a heatmap tile (a tile filters the table to it), then an entry in the inspector',
      },
    ],
    copy: ['coverage'],
    components: [
      'StatGroup',
      'Card',
      'CardHeader',
      'CardTitle',
      'CardDescription',
      'CardContent',
      'Toolbar',
      'ToolbarStart',
      'Button',
      'DataTable',
      'Badge',
      'StatusBadge',
    ],
    files: ['views/Integrity'],
    screens: [
      {
        scenario: 'errors',
        hash: '#integrity',
        wait: { role: 'heading', name: 'Coverage by Component' },
      },
      {
        scenario: 'empty',
        state: 'empty',
        hash: '#integrity',
        wait: { role: 'heading', name: 'Coverage', exact: true },
      },
    ],
  },
  {
    id: 'a11y.rules',
    section: 'a11y',
    title: 'Accessibility rules',
    purpose:
      'axe violations grouped by rule, new ones first, with impact, entries, nodes and how many are accepted; a review session for the new ones.',
    states: {
      empty: 'Without a check, or with accessibility scans off: what to run.',
      static: 'No review button.',
    },
    interactions: [
      { action: 'Open the entries of a rule in the inspector' },
      { action: 'Start an accessibility review session' },
    ],
    copy: ['a11y'],
    components: [
      'StatGroup',
      'Button',
      'Card',
      'CardHeader',
      'CardTitle',
      'CardDescription',
      'CardContent',
      'DataTable',
      'StatusBadge',
      'Badge',
    ],
    files: ['views/Accessibility'],
    screens: [
      { scenario: 'a11y', hash: '#a11y', wait: { role: 'heading', name: 'Rules', exact: true } },
    ],
  },
  {
    id: 'runs.history',
    section: 'runs',
    title: 'Runs',
    purpose:
      "The last check's timing, then changed entries and engine time per run as lines, and every recorded run as a table.",
    states: { empty: 'Without a history file: where it is written.' },
    interactions: [{ action: 'Read a value from the chart tooltip' }],
    copy: ['runs'],
    components: [
      'Card',
      'CardHeader',
      'CardTitle',
      'CardDescription',
      'CardContent',
      'StatGroup',
      'Chart',
      'DataTable',
    ],
    files: ['views/History', 'parts/Charts', 'parts/RunCharts'],
    screens: [
      {
        scenario: 'clean',
        hash: '#history',
        wait: { role: 'heading', name: 'Engine Time per Run' },
      },
    ],
  },
  {
    id: 'diagnostics.research',
    section: 'diagnostics',
    title: 'Diagnostics',
    purpose:
      'Research data, when a run wrote it: detection rate per scenario suite, scenario results with their renders, gate calibration and engine performance.',
    states: {
      empty: 'Each part says which tool writes its data; the section is hidden when there is none.',
    },
    interactions: [
      { action: 'Choose a part, a suite or a scenario' },
      { action: 'Filter scenario renders and open one in the inspector' },
    ],
    copy: ['diagnostics'],
    components: [
      'Toolbar',
      'ToolbarStart',
      'ToolbarField',
      'ToolbarSummary',
      'SegmentedChoice',
      'Card',
      'CardHeader',
      'CardTitle',
      'CardDescription',
      'CardContent',
      'KeyValueList',
      'KeyValueItem',
      'StatusBadge',
      'Chart',
      'DataTable',
      'Badge',
      'Progress',
      'Select',
      'StatGroup',
    ],
    files: [
      'views/Diagnostics',
      'views/Scenarios',
      'views/Calibration',
      'views/Performance',
      'parts/Charts',
    ],
    screens: [
      {
        scenario: 'clean',
        hash: '#diagnostics',
        wait: { role: 'heading', name: 'Batch Check by Thread Count' },
      },
    ],
  },
  {
    id: 'help.reference',
    section: 'help',
    title: 'Help',
    purpose:
      'First, how approving works: the dashboard link, its timing, and the connection and approval badges. Then what each section, card icon, status, coverage code, inspector region and key means, beside a drawing of where it appears, and which pxsig, engine and UI contract versions drew the page.',
    states: {},
    interactions: [{ action: 'Point at or focus a row to highlight its place in the drawing' }],
    copy: ['help'],
    components: ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'Icon'],
    files: ['views/Help', 'parts/Schematic'],
    screens: [
      { scenario: 'clean', hash: '#help', wait: { role: 'heading', name: 'Keyboard Shortcuts' } },
    ],
  },
];
