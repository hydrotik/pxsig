/**
 * Every dashboard feature, as data: where it lives, what it is for, the states it shows, how it is
 * used, its copy, the contract components it renders and the files that implement it.
 * docs/ui/features.md is generated from this file (`pnpm ui:docs`), and `pnpm ui:check` fails when
 * an entry names a component, file or copy key that does not exist, when a listed component is not
 * imported by one of the feature's files, or when a view or contract component belongs to no
 * feature.
 *
 * Plain data with type-only imports, so Node reads it without a build (type stripping).
 */
import type { ComponentName } from './contract';

export type Section =
  | 'shell'
  | 'overview'
  | 'review'
  | 'coverage'
  | 'a11y'
  | 'runs'
  | 'diagnostics'
  | 'help'
  | 'inspector'
  | 'embed';
export type State = 'loading' | 'empty' | 'error' | 'offline' | 'static';

export interface Feature {
  id: string;
  section: Section;
  title: string;
  purpose: string;
  /** What the feature shows in each state it handles. */
  states: Partial<Record<State, string>>;
  /** What a person does with it; `keys` are keyboard shortcuts. */
  interactions: { action: string; keys?: string }[];
  /** Copy keys (or key prefixes) in src/copy/en.json. */
  copy: string[];
  components: ComponentName[];
  /** Source files under src/, without the extension. */
  files: string[];
  /**
   * What `pxsig dashboard check` renders for this feature, each in every theme: a scenario from
   * fixtures/scenarios.mjs, the address (`query`, `hash`), clicks or keys to get there, and the
   * landmark that says the feature rendered. `pnpm ui:check` fails a feature without one.
   */
  screens: Screen[];
}

/** An element found by role and accessible name (a substring unless `exact`), or by its text. */
export type Target =
  | { role: string; name?: string; exact?: boolean }
  | { text: string; exact?: boolean };

export interface Screen {
  scenario: string;
  /** The state of `states` this screen shows, when it shows one. */
  state?: State;
  /** The query string, without `?` (`embed=1&story=…`); the check adds `theme`. */
  query?: string;
  /** The hash, with `#` (`#overview`, `#inspect=<id>`). */
  hash?: string;
  actions?: ({ click: Target } | { press: string })[];
  wait: Target;
}

export const FEATURES: Feature[] = [
  {
    id: 'shell.top-bar',
    section: 'shell',
    title: 'Top bar',
    purpose:
      "The report's title (its label, else the project name) with the versions on hover, the section links with their counts, and the controls pinned at the end: start review, project, modes, connection, last check, theme, review status.",
    states: {
      loading: 'The page shows a loading line until the first data arrives.',
      error: 'The page shows the load error instead of the dashboard.',
      offline: 'The connection badge reads Offline; the review button is hidden.',
      static: 'The connection badge reads Static report; nothing that writes is shown.',
    },
    interactions: [
      { action: 'Open a section (a plain #<id> link; Back and Forward move between sections)' },
      { action: 'Start a review session on the next queue with undecided entries' },
      { action: 'Switch project (when the server holds more than one)' },
    ],
    copy: ['app', 'tabs'],
    components: [
      'AppShell',
      'AppMain',
      'TopNav',
      'NavList',
      'NavLink',
      'NavEnd',
      'Badge',
      'StatusBadge',
      'Button',
      'Select',
      'Tooltip',
    ],
    files: ['App'],
    screens: [
      {
        scenario: 'clean',
        hash: '#overview',
        wait: { role: 'navigation', name: 'Report sections' },
      },
      { scenario: 'loading', state: 'loading', hash: '#overview', wait: { text: 'Loading' } },
      {
        scenario: 'load-error',
        state: 'error',
        hash: '#overview',
        wait: { text: 'Report data failed to load' },
      },
      {
        scenario: 'offline',
        state: 'offline',
        hash: '#overview',
        wait: { text: 'Offline', exact: true },
      },
      {
        scenario: 'static',
        state: 'static',
        hash: '#overview',
        wait: { text: 'Static report', exact: true },
      },
      {
        scenario: 'several-projects',
        hash: '#overview',
        wait: { role: 'combobox', name: 'Project' },
      },
    ],
  },
  {
    id: 'shell.theme',
    section: 'shell',
    title: 'Theme toggle',
    purpose: 'Switches between the light and dark theme; the choice is remembered per viewer.',
    states: {},
    interactions: [{ action: 'Toggle light / dark' }],
    copy: ['app.theme'],
    components: ['UiProvider', 'IconButton', 'Icon'],
    files: ['App', 'main'],
    screens: [{ scenario: 'clean', hash: '#help', wait: { role: 'button', name: 'theme' } }],
  },
  {
    id: 'shell.coverage-banner',
    section: 'shell',
    title: 'Coverage banner',
    purpose:
      'Shown on every section while the coverage ledger has errors, or entries wait for a first approval: the headline, setup problems, a link to Coverage and the safe repair. On the Overview the errors card carries the errors instead, so they are not shown twice.',
    states: { static: 'No repair button: a static report cannot write.' },
    interactions: [
      { action: 'View the components with problems' },
      { action: 'Run the safe repair (never approves, never writes a signature)' },
    ],
    copy: ['coverage.banner', 'coverage.headline'],
    components: ['Alert', 'AlertTitle', 'AlertDescription', 'Button'],
    files: ['views/Integrity'],
    screens: [
      { scenario: 'first-approval', hash: '#stories', wait: { text: 'Needs a first approval' } },
    ],
  },
  {
    id: 'overview.counts',
    section: 'overview',
    title: 'Latest check in numbers',
    purpose:
      'Checked, passed, changed, flaky, new accessibility violations and duration of the last check; the changed, flaky and accessibility figures open what they count.',
    states: { empty: 'Without a check: the command that runs one.' },
    interactions: [{ action: 'Open a review session, or the filtered list (static)' }],
    copy: ['overview.cards', 'empty.noCheck'],
    components: ['StatGroup'],
    files: ['views/Overview', 'parts/Affordance'],
    screens: [
      { scenario: 'clean', hash: '#overview', wait: { role: 'button', name: 'Flaky' } },
      { scenario: 'empty', state: 'empty', hash: '#overview', wait: { text: 'No check results' } },
    ],
  },
  {
    id: 'overview.open-items',
    section: 'overview',
    title: 'Open Items',
    purpose:
      'What needs a decision, one row per kind (changed, new, rejected, render errors, coverage errors, accessibility, flaky), each with its action.',
    states: { empty: 'A line saying nothing is open; the rows stay, at zero.' },
    interactions: [{ action: 'Start a review, or view the entries, from a row' }],
    copy: ['overview'],
    components: ['Card', 'CardHeader', 'CardTitle', 'CardContent', 'DataTable', 'Button'],
    files: ['views/Overview'],
    screens: [
      { scenario: 'changed', hash: '#overview', wait: { role: 'heading', name: 'Open Items' } },
    ],
  },
  {
    id: 'overview.layout',
    section: 'overview',
    title: 'Overview columns',
    purpose:
      'Below the counts, two equal columns: open items, then stale entries by component, on the left; errors (only while there are any), then changed entries per run, on the right. One column, left then right, when the page is narrow.',
    states: {},
    interactions: [],
    copy: ['overview'],
    components: ['Card'],
    files: ['views/Overview'],
    screens: [
      {
        scenario: 'errors',
        hash: '#overview',
        wait: { role: 'heading', name: 'Changed Entries per Run' },
      },
    ],
  },
  {
    id: 'overview.errors',
    section: 'overview',
    title: 'Errors',
    purpose:
      "The coverage banner's details and the safe repair first (only while there is something to repair or approve), then the render errors of the last check and coverage errors (components, setup), one row each, opening the render errors list or Coverage on that component. Shown only while there are errors.",
    states: { static: 'No repair button: a static report cannot write.' },
    interactions: [
      { action: 'Open the render errors, or Coverage on a component, from a row' },
      { action: 'Run the safe repair' },
    ],
    copy: ['overview.errors', 'coverage.banner', 'coverage.headline'],
    components: [
      'Card',
      'CardHeader',
      'CardTitle',
      'CardDescription',
      'CardContent',
      'DataTable',
      'Button',
    ],
    files: ['views/Overview', 'views/Integrity'],
    screens: [
      {
        scenario: 'errors',
        hash: '#overview',
        wait: { role: 'heading', name: 'Errors', exact: true },
      },
    ],
  },
  {
    id: 'overview.changed-runs',
    section: 'overview',
    title: 'Changed Entries per Run',
    purpose: 'The Runs chart of changed entries per recorded run, as a line, in the right column.',
    states: { empty: 'Without recorded runs the chart is not shown.' },
    interactions: [{ action: 'Read a value from the chart tooltip' }],
    copy: ['runs.changed'],
    components: ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'Chart'],
    files: ['parts/RunCharts', 'parts/Charts'],
    screens: [
      {
        scenario: 'clean',
        hash: '#history',
        wait: { role: 'heading', name: 'Changed Entries per Run' },
      },
    ],
  },
  {
    id: 'overview.stale',
    section: 'overview',
    title: 'Stale Entries by Component',
    purpose:
      'A heatmap of the components with stale verdicts: one tile per component, coloured by its share of stale entries in five steps, with the count on the tile, highest share first. The Overview shows the first 12, Coverage all of them.',
    states: { empty: 'No stale entries: a line saying so.' },
    interactions: [
      { action: 'Open Coverage on a component from its tile' },
      { action: 'View all on Coverage' },
    ],
    copy: ['coverage.stale'],
    components: [
      'Card',
      'CardHeader',
      'CardTitle',
      'CardDescription',
      'CardContent',
      'Heatmap',
      'Button',
    ],
    files: ['parts/StaleHeatmap'],
    screens: [
      {
        scenario: 'stale',
        hash: '#overview',
        wait: { role: 'list', name: 'Stale entries by component' },
      },
      { scenario: 'clean', state: 'empty', hash: '#overview', wait: { text: 'No stale entries' } },
    ],
  },
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
      'What each section, card icon, status, coverage code, inspector region and key means, beside a drawing of where it appears, and which pxsig, engine and UI contract versions drew the page.',
    states: {},
    interactions: [{ action: 'Point at or focus a row to highlight its place in the drawing' }],
    copy: ['help'],
    components: ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'Icon'],
    files: ['views/Help', 'parts/Schematic'],
    screens: [
      { scenario: 'clean', hash: '#help', wait: { role: 'heading', name: 'Keyboard Shortcuts' } },
    ],
  },
  {
    id: 'inspector.header',
    section: 'inspector',
    title: 'Inspector header',
    purpose:
      'The entry id, its context and reasons, its verdict, its other modes and states, the position in the list, the review buttons and Close.',
    states: { static: 'No review buttons.' },
    interactions: [
      { action: 'Approve or reject (accept, in an accessibility session)', keys: 'A / R' },
      { action: 'Previous or next entry', keys: '← → (J / K)' },
      { action: 'Switch mode or state of the same story' },
      { action: 'Close', keys: 'Esc' },
    ],
    copy: [
      'inspector.review',
      'inspector.nav',
      'inspector.variant',
      'inspector.contextLatest',
      'inspector.contextScenario',
      'inspector.withinGate',
      'inspector.close',
      'inspector.rejectedNote',
    ],
    components: [
      'Dialog',
      'DialogTitle',
      'DialogDescription',
      'StatusBadge',
      'SegmentedChoice',
      'IconButton',
      'Button',
      'CopyValue',
    ],
    files: ['inspector/Inspector', 'parts/StatusOf'],
    screens: [
      {
        scenario: 'changed',
        hash: '#inspect=ui-button--primary',
        wait: { role: 'dialog', name: 'ui-button--primary' },
      },
    ],
  },
  {
    id: 'inspector.stage',
    section: 'inspector',
    title: 'Image stage',
    purpose:
      'Baseline and latest render side by side, as a swipe, onion skin, pixel difference or signature cells; pan, zoom, change regions and detail tiles; built on the diff-viewer primitives.',
    states: {
      loading: 'A loading line until both images decode.',
      error: 'Which image is missing.',
    },
    interactions: [
      { action: 'Choose the view', keys: '1–5' },
      { action: 'Fit, actual size, zoom', keys: 'F, 0, + −' },
      { action: 'Next or previous change', keys: 'N / ⇧N' },
      { action: 'Drag to pan, wheel to zoom, drag the swipe handle (or arrow keys on it)' },
      {
        action: 'Tolerance, swipe, opacity and cell sliders; highlight, regions and tiles switches',
      },
    ],
    copy: [
      'inspector.modes',
      'inspector.sliders',
      'inspector.toggles',
      'inspector.stage',
      'inspector.keys',
      'inspector.fit',
      'inspector.actual',
      'inspector.zoomIn',
      'inspector.zoomOut',
      'inspector.loading',
      'inspector.missing',
    ],
    components: [
      'Toolbar',
      'ToolbarStart',
      'ToolbarEnd',
      'SegmentedChoice',
      'IconButton',
      'Button',
      'Slider',
      'Switch',
      'Kbd',
    ],
    files: ['inspector/Inspector', 'inspector/Stage'],
    screens: [
      {
        scenario: 'changed',
        hash: '#inspect=ui-button--primary',
        wait: { role: 'group', name: 'Image comparison' },
      },
    ],
  },
  {
    id: 'inspector.details',
    section: 'inspector',
    title: 'Inspector details',
    purpose:
      'The pixel under the pointer, pixel changes and regions, signature metrics and images, accessibility violations and the files of the entry, with the Storybook link.',
    states: {
      static: 'Pixel values need the server (a static report cannot read the images’ pixels).',
    },
    interactions: [
      { action: 'Read a pixel; focus a region' },
      { action: 'Take one rule off the accepted list' },
      { action: 'Copy a file path; open a file or the story in Storybook' },
    ],
    copy: [
      'inspector.sections',
      'inspector.pixel',
      'inspector.changes',
      'inspector.metrics',
      'inspector.a11y',
      'inspector.files',
      'inspector.storybook',
      'inspector.artifacts',
    ],
    components: ['KeyValueList', 'KeyValueItem', 'Badge', 'StatusBadge', 'Button', 'Link', 'Icon'],
    files: ['inspector/Inspector'],
    screens: [
      {
        scenario: 'changed',
        hash: '#inspect=ui-button--primary',
        wait: { role: 'heading', name: 'Metrics', exact: true },
      },
    ],
  },
  {
    id: 'inspector.session',
    section: 'inspector',
    title: 'Review session',
    purpose:
      'A queue (changed, new or accessibility) opened in the inspector with progress, then a summary of what was decided and what to run next.',
    states: { empty: 'The summary when every entry is decided.' },
    interactions: [
      { action: 'Decide each entry; the next undecided one opens' },
      { action: 'Back to the overview, view the rejected, or keep browsing' },
    ],
    copy: ['inspector.session'],
    components: [
      'Progress',
      'Dialog',
      'DialogTitle',
      'KeyValueList',
      'KeyValueItem',
      'CopyValue',
      'Button',
    ],
    files: ['inspector/Inspector'],
    screens: [
      {
        scenario: 'changed',
        hash: '#overview',
        actions: [{ click: { role: 'button', name: 'Review 2 changes' } }],
        wait: { role: 'progressbar', name: 'Review progress' },
      },
    ],
  },
  {
    id: 'embed.panel',
    section: 'embed',
    title: 'Storybook panel',
    purpose:
      'The inspector for one story inside the Storybook addon panel, without the page chrome; details open on demand.',
    states: { empty: 'A line when the story has no checked entry.' },
    interactions: [
      { action: 'The inspector keys, on the focused panel' },
      { action: 'Show or hide details' },
    ],
    copy: ['app.embedEmpty', 'inspector.toggles.details'],
    components: ['Switch', 'IconButton', 'SegmentedChoice'],
    files: ['App', 'inspector/Inspector'],
    screens: [
      {
        scenario: 'changed',
        query: 'embed=1&story=ui-button--primary',
        wait: { role: 'group', name: 'Image comparison' },
      },
    ],
  },
  {
    id: 'embed.decide',
    section: 'embed',
    title: 'Decision window',
    purpose:
      "The small window the Storybook panel's Approve, Reject and Accept go through: the panel is a frame on another site, where the dashboard link is not sent, so the window (this server's own page) takes the decision from the panel, posts it and closes. Without the dashboard link it stays open and says to open the link first; a tab without it shows the same instruction under the inspector's header.",
    states: {
      error:
        'The decision was not recorded: the reason, or the instruction to open the dashboard link first.',
      empty: 'Opened on its own (no panel behind it): a line saying it has nothing to do.',
    },
    interactions: [
      {
        action:
          'Approve, reject or accept in the Storybook panel opens it; it closes once the decision is recorded',
      },
    ],
    copy: ['app.decide', 'inspector.review.needsLink'],
    components: [],
    files: ['views/Decide', 'link', 'main'],
    screens: [{ scenario: 'clean', state: 'empty', query: 'decide=1', wait: { role: 'status' } }],
  },
];
