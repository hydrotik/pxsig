/** The React features (features.ts): Diagnostics › React, its Compiler and Renders tabs. */
import type { Feature } from '../features.ts';

const REACT_FILES = ['views/Diagnostics', 'views/react/ReactView', 'views/react/shared'];

export const REACT: Feature[] = [
  {
    id: 'diagnostics.react-compiler',
    section: 'diagnostics',
    title: 'React Compiler',
    purpose:
      "The React Compiler's verdict on the changed component and hook files, at the merge base and now: alerts first (newly skipped, new and skipped, a new reason, a new finding), every function analysed on demand, and one function's diagnostics, base and entries in a side panel. Alerts only: nothing here fails a check or asks for a decision.",
    states: {
      loading: 'Analysing: a progress row with Skip; the table keeps the last results, busy.',
      empty: 'No results yet, with Analyse; no alerts, or no changed files, in the table.',
      error: 'The last analysis failed: what happened, and that checks are not affected.',
      static: 'No Analyse: a static report cannot run anything.',
      readOnly: 'Analyse and Skip are disabled: they need the dashboard link.',
      canApprove: 'Analyse and Skip work (they decide nothing).',
    },
    interactions: [
      { action: 'Choose Compiler or Renders' },
      { action: 'Analyse now; Skip a running analysis' },
      { action: 'Alerts or every function analysed; search' },
      {
        action: "Open a function's details; open an entry it reaches in the inspector",
        keys: 'Esc closes',
      },
    ],
    copy: ['diagnostics.tabs.react', 'diagnostics.react'],
    components: [
      'Toolbar',
      'ToolbarStart',
      'ToolbarEnd',
      'ToolbarSummary',
      'SegmentedChoice',
      'Button',
      'Badge',
      'Progress',
      'Alert',
      'AlertTitle',
      'AlertDescription',
      'Link',
      'Card',
      'CardHeader',
      'CardTitle',
      'CardDescription',
      'CardContent',
      'DataTable',
      'SidePanelLayout',
      'SidePanelMain',
      'SidePanel',
      'KeyValueList',
      'KeyValueItem',
      'CopyValue',
    ],
    files: [...REACT_FILES, 'views/react/Compiler', 'views/react/CompilerPanel'],
    screens: [
      { scenario: 'react', hash: '#react', wait: { role: 'heading', name: 'React Compiler' } },
      {
        scenario: 'react',
        hash: '#react',
        actions: [
          { click: { role: 'button', name: 'All analysed (9)' } },
          { click: { text: 'Button', exact: true } },
        ],
        wait: { role: 'complementary', name: 'Button' },
      },
      {
        scenario: 'react-running',
        state: 'loading',
        hash: '#react',
        wait: { text: 'Analysing 3 of 4 files…' },
      },
      { scenario: 'react-off', hash: '#react', wait: { text: 'React analysis is off' } },
      {
        scenario: 'react-not-installed',
        hash: '#react',
        wait: { text: 'Compiler analysis needs babel-plugin-react-compiler' },
      },
      { scenario: 'react-no-base', hash: '#react', wait: { text: 'No merge base with main' } },
    ],
  },
  {
    id: 'diagnostics.react-renders',
    section: 'diagnostics',
    title: 'React renders',
    purpose:
      "React's commits and renders per entry, counted while pxsig rendered it: the entries React was still committing at capture first, every entry measured on demand, and one entry's counts, top components and counts before in a side panel. Measure renders runs a visual check of the entries in scope with counting on; Cancel stops it, and the entries rendered by then keep their new results.",
    states: {
      loading: 'Measuring: a progress row with Cancel; Measure renders is disabled.',
      empty: 'No render counts yet: what Measure renders does.',
      static: 'No Measure renders and no Scope.',
      readOnly: 'Measure renders and Cancel are disabled: they need the dashboard link.',
      canApprove: 'Measure renders and Cancel work (a re-check, not a decision).',
    },
    interactions: [
      { action: 'Scope: every entry, the ones shown, or the one in the side panel' },
      { action: 'Measure renders; Cancel a run' },
      {
        action: "Alerts or every entry measured; open an entry's details or the inspector",
        keys: 'Esc closes',
      },
    ],
    copy: ['diagnostics.react.renders'],
    components: [
      'Toolbar',
      'ToolbarStart',
      'ToolbarEnd',
      'ToolbarField',
      'Select',
      'SegmentedChoice',
      'Button',
      'Badge',
      'Progress',
      'Card',
      'CardHeader',
      'CardTitle',
      'CardDescription',
      'CardContent',
      'DataTable',
      'SidePanelLayout',
      'SidePanelMain',
      'SidePanel',
      'KeyValueList',
      'KeyValueItem',
    ],
    files: [...REACT_FILES, 'views/react/Renders', 'views/react/RendersPanel'],
    screens: [
      {
        scenario: 'react',
        hash: '#react-renders',
        wait: { role: 'heading', name: 'Renders per Entry' },
      },
      {
        scenario: 'react',
        hash: '#react-renders',
        actions: [
          { click: { role: 'button', name: 'All measured (7)' } },
          { click: { text: 'ui-datagrid--many-rows', exact: true } },
        ],
        wait: { role: 'complementary', name: 'ui-datagrid--many-rows' },
      },
      {
        scenario: 'react-measuring',
        state: 'loading',
        hash: '#react-renders',
        wait: { text: 'Measuring 3 of 7 entries…' },
      },
      {
        scenario: 'react-unmeasured',
        state: 'empty',
        hash: '#react-renders',
        wait: { text: 'No render counts yet' },
      },
    ],
  },
  {
    id: 'inspector.react',
    section: 'inspector',
    title: 'React in the inspector',
    purpose:
      "In the header, beside the verdict: a Still rendering badge when React was still committing at capture (its title is the alert), a likely cause of a flaky entry; it never changes the verdict, the decision buttons or the review queue. In the side panel, after Accessibility: the entry's render counts, whether React had settled, its top components and the counts before, and the React Compiler alerts whose file reaches the entry, each opening Diagnostics › React on that function. Neither in the Storybook panel.",
    states: {},
    interactions: [{ action: 'Open a compiler alert in Diagnostics › React' }],
    copy: ['inspector.react', 'inspector.sections.react', 'diagnostics.react.renders'],
    components: ['Badge', 'Button', 'KeyValueList', 'KeyValueItem'],
    files: ['inspector/Header', 'inspector/side/ReactSection', 'inspector/side/Side'],
    screens: [
      {
        scenario: 'react',
        hash: '#inspect=ui-button--primary',
        wait: { text: 'Still rendering', exact: true },
      },
      {
        scenario: 'react',
        hash: '#inspect=ui-button--primary',
        // The section is below the side panel's fold. A click scrolls its target to the middle of
        // the panel: the Not compiled badge (no action) sits mid-section, so all of it shows.
        actions: [{ click: { text: 'Not compiled', exact: true } }],
        wait: { role: 'heading', name: 'Compiler alerts (1)' },
      },
    ],
  },
  {
    id: 'shell.react-strip',
    section: 'shell',
    title: 'React progress strip',
    purpose:
      'At the top of every section while the server analyses React files (with Skip) or measures renders (with Cancel), then how the run ended (the alerts in one line, skipped, failed, measured, cancelled) until dismissed. Never takes focus, blocks or counts down; only the start and the end are announced.',
    states: {
      loading: 'A bar per run going on, with its count.',
      error: 'The analysis failed: what happened, and that checks are not affected.',
      offline: 'The rows stay as they were; Skip and Cancel are disabled.',
      static: 'Not shown.',
      readOnly: 'Skip and Cancel are disabled: they need the dashboard link.',
    },
    interactions: [
      { action: 'Skip the analysis; Cancel the measuring' },
      { action: 'Open React or Renders from the end line; Dismiss it' },
    ],
    copy: ['app.react', 'app.check.dismiss'],
    components: ['Progress', 'Button', 'Alert', 'AlertTitle', 'AlertDescription'],
    files: ['parts/ReactStrip', 'App'],
    screens: [
      {
        scenario: 'react-running',
        state: 'loading',
        hash: '#overview',
        wait: { text: '3 of 4 files · 2 cached' },
      },
      {
        scenario: 'react-measuring',
        state: 'loading',
        hash: '#overview',
        wait: { text: 'Measuring renders (visual check)' },
      },
      { scenario: 'react-done', hash: '#overview', wait: { text: 'React: 2 newly skipped' } },
    ],
  },
  {
    id: 'overview.react',
    section: 'overview',
    title: 'React',
    purpose:
      'In the Overview end column, after Errors: the compiler analysis and render counts in four figures (newly skipped, findings, compiled, still rendering), each opening the React view where it is listed. Alerts only, not blocking; shown only when there are results.',
    states: {
      loading:
        'While an analysis runs: the last figures, the file count under the description, busy.',
      empty: 'Not shown without results, or when React is off.',
    },
    interactions: [{ action: 'Open Diagnostics › React on what a figure counts' }],
    copy: ['overview.react', 'app.react.files', 'app.react.filesNoCache'],
    components: ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'StatGroup'],
    files: ['views/Overview', 'views/react/OverviewCard', 'parts/Affordance'],
    screens: [
      { scenario: 'react', hash: '#overview', wait: { role: 'heading', name: 'React' } },
      { scenario: 'react-not-installed', hash: '#overview', wait: { text: 'Not installed' } },
    ],
  },
];
