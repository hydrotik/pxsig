/** The inspector and embed features (features.ts). */
import type { Feature } from '../features.ts';

export const INSPECTOR: Feature[] = [
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
    files: ['inspector/Inspector', 'inspector/Header', 'inspector/controls', 'parts/StatusOf'],
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
    files: ['inspector/Inspector', 'inspector/controls', 'inspector/Stage'],
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
    files: [
      'inspector/Inspector',
      'inspector/side/PixelSection',
      'inspector/side/ChangesSection',
      'inspector/side/MetricsSection',
      'inspector/side/A11ySection',
      'inspector/side/FilesSection',
    ],
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
    files: ['inspector/Inspector', 'inspector/SessionSummary'],
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
    files: ['App', 'inspector/Inspector', 'inspector/controls', 'inspector/side/ViewSection'],
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
