/** The overview features (features.ts): the latest check in numbers and what needs attention. */
import type { Feature } from '../features.ts';

export const OVERVIEW: Feature[] = [
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
];
