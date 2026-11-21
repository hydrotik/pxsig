/** The shell features (features.ts): the top bar, the theme and the coverage banner. */
import type { Feature, Screen } from '../features.ts';

export const SHELL: Feature[] = [
  {
    id: 'shell.top-bar',
    section: 'shell',
    title: 'Top bar',
    purpose:
      "The report's title (its label, else the project name) with the versions and the dashboard build on hover, the section links with their counts, and the controls pinned at the end: start review, project, modes, connection with whether this page can approve (Read only / Can approve, the command for a dashboard link on hover), last check, theme, review status.",
    states: {
      loading: 'The page shows a loading line until the first data arrives.',
      error: 'The page shows the load error instead of the dashboard.',
      offline: 'The connection badge reads Offline; the review button is hidden.',
      static: 'The connection badge reads Static report · Read only; nothing that writes is shown.',
      readOnly:
        'Live · Read only: this page holds no dashboard link; the review buttons are disabled.',
      canApprove: 'Live · Can approve: this page opened the dashboard link.',
      wide: 'Every link and every end control in the bar, the last check among them, while they all fit.',
      narrow:
        "One line at every width, what shows measured, never set by breakpoints: first the last check (then said in the connection's hint), the modes tag and the status beside the review button go; then the workspace label is capped at 24ch (always below 1024px); then the links move into More, the last first, Help kept; then the label truncates. Every section stays reachable, nothing covered or clipped, down to 640px. Widening reverses it, and a wider bar never shows fewer links or end controls.",
      compact:
        'Below 640px, down to 390px: the project picker narrows, the review button takes a short label, the connection and the review status become glyphs (their words in their names), and the gaps tighten; still one line, with no sideways scroll.',
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
    files: ['App', 'parts/TopBar', 'parts/useTopBarFit', 'parts/Connection', 'link'],
    screens: [
      {
        scenario: 'clean',
        state: 'canApprove',
        hash: '#overview',
        wait: { text: 'Can approve', exact: true },
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
        scenario: 'read-only',
        state: 'readOnly',
        hash: '#overview',
        wait: { text: 'Read only', exact: true },
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
      // The bar as it narrows (`narrow`, `compact`), and wide enough for the last check.
      {
        scenario: 'clean',
        state: 'wide',
        hash: '#overview',
        width: 1440,
        wait: { text: 'Last check' },
      },
      ...[800, 640, 390].flatMap((width): Screen[] => [
        {
          scenario: 'changed',
          state: width < 640 ? 'compact' : 'narrow',
          hash: '#overview',
          width,
          wait: { role: 'navigation', name: 'Report sections' },
        },
        {
          scenario: 'several-projects',
          state: width < 640 ? 'compact' : 'narrow',
          hash: '#overview',
          width,
          wait: { role: 'combobox', name: 'Project' },
        },
      ]),
      {
        scenario: 'changed',
        state: 'narrow',
        hash: '#overview',
        width: 800,
        actions: [{ click: { role: 'button', name: 'More' } }],
        wait: { role: 'menu' },
      },
      // A long workspace label: capped at 24ch, its full name in its title.
      { scenario: 'long-label', hash: '#overview', wait: { role: 'heading', name: 'Acme' } },
      {
        scenario: 'long-label',
        state: 'narrow',
        hash: '#overview',
        width: 800,
        wait: { role: 'heading', name: 'Acme' },
      },
    ],
    anchors: [{ name: 'top-bar', target: { role: 'navigation', name: 'Report sections' } }],
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
    files: ['parts/TopBar', 'main'],
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
];
