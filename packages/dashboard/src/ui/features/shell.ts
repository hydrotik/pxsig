/** The shell features (features.ts): the top bar, the theme and the coverage banner. */
import type { Feature } from '../features.ts';

export const SHELL: Feature[] = [
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
];
