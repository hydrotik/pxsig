/** The inspector and embed features (features.ts). */
import type { Feature } from '../features.ts';

export const INSPECTOR: Feature[] = [
  {
    id: 'inspector.header',
    section: 'inspector',
    title: 'Inspector header',
    purpose:
      'The entry id, its context and reasons, its verdict, its other modes and states, the position in the list, the review buttons and Close.',
    states: {
      static: 'No review buttons.',
      readOnly:
        'A note under the header gives the command for a dashboard link, with a copy button; Reject, Approve and Undo stay in place, disabled.',
    },
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
      {
        scenario: 'read-only',
        state: 'readOnly',
        hash: '#inspect=ui-button--primary',
        wait: { text: 'Read only: approving needs the dashboard link. In a terminal, in the' },
      },
    ],
    anchors: [
      { name: 'reject', target: { role: 'button', name: 'Reject', exact: true } },
      { name: 'approve', target: { role: 'button', name: 'Approve', exact: true } },
      { name: 'close', target: { role: 'button', name: 'Close', exact: true } },
    ],
  },
  {
    id: 'inspector.stage',
    section: 'inspector',
    title: 'Image stage',
    purpose:
      'Baseline and latest render side by side, as a swipe, onion skin, pixel difference or signature cells; pan, zoom, change regions and detail tiles; Originals shows the two images with no analysis drawn; built on the diff-viewer primitives.',
    states: {
      loading: 'A loading line until both images decode.',
      error: 'Which image is missing.',
    },
    interactions: [
      { action: 'Choose the view', keys: '1–5' },
      { action: 'Fit, actual size, zoom', keys: 'F, 0, + −' },
      { action: 'Next or previous change', keys: 'N / ⇧N' },
      { action: 'Originals: the images without analysis, not saved', keys: 'O' },
      { action: 'Drag to pan, wheel to zoom, drag the swipe handle (or arrow keys on it)' },
      {
        action: 'Swipe, opacity and cell sliders; originals, highlight, regions and tiles switches',
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
      {
        // Originals on, fitted: the first change chosen once the analysis is done (the same one
        // the entry opens on), then O and F; the last click leaves the pointer off the images.
        scenario: 'changed',
        hash: '#inspect=ui-button--primary',
        actions: [
          { click: { role: 'button', name: '24×32 @ 56,120' } },
          { press: 'o' },
          { press: 'f' },
          { click: { role: 'heading', name: 'ui-button--primary' } },
        ],
        wait: { role: 'switch', name: 'Show the original images without analysis' },
      },
    ],
    anchors: [{ name: 'next-change', target: { role: 'button', name: 'Next change' } }],
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
      {
        action: 'Tolerance: how far a pixel must change to count (disabled while Originals is on)',
      },
      { action: 'Take one rule off the accepted list' },
      { action: 'Copy a file path; open a file or the story in Storybook' },
    ],
    copy: [
      'inspector.sections',
      'inspector.pixel',
      'inspector.changes',
      'inspector.sliders.tolerance',
      'inspector.metrics',
      'inspector.a11y',
      'inspector.files',
      'inspector.storybook',
      'inspector.artifacts',
    ],
    components: [
      'KeyValueList',
      'KeyValueItem',
      'Badge',
      'StatusBadge',
      'Button',
      'Link',
      'Icon',
      'Slider',
    ],
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
    anchors: [
      { name: 'side-panel', target: { role: 'complementary' } },
      { name: 'tolerance', target: { role: 'group', name: 'Tolerance' } },
    ],
  },
  {
    id: 'inspector.text',
    section: 'inspector',
    title: 'Text labels',
    purpose:
      "What changed in the entry's text, from its text record: in the header, beside the verdict, a badge (Copy, Copy, reflow, Text moved or Text restyled; none for a pixel change); in the side panel, after Pixel Changes, a Text section with the summary and each change as a sentence (a space shown as ␠) that shows its box on the stage, or why nothing was compared. Labels only: the gate, the verdict, the decision buttons and the review queue are the same without them.",
    states: {
      empty:
        'No text record in the baseline, another environment, a record not read, or no text changed: one muted line instead of the changes.',
    },
    interactions: [{ action: 'Choose a text change to show its box on the stage' }],
    copy: ['inspector.sections.text', 'inspector.text'],
    components: ['Badge'],
    files: [
      'inspector/Header',
      'inspector/textSay',
      'inspector/side/TextSection',
      'inspector/side/Side',
      'inspector/Inspector',
    ],
    screens: [
      {
        // The Text section is below the side panel's fold: Pixel Changes, just above it, scrolled
        // to the panel's top, so both show.
        scenario: 'text',
        hash: '#inspect=ui-stat-tile--counts',
        actions: [{ scroll: { role: 'heading', name: 'Pixel Changes', exact: true } }],
        wait: { text: 'Copy, reflow', exact: true },
      },
      {
        scenario: 'text',
        hash: '#inspect=ui-section-header--default',
        actions: [{ scroll: { role: 'heading', name: 'Pixel Changes', exact: true } }],
        wait: { text: 'Text restyled', exact: true },
      },
      {
        scenario: 'text',
        state: 'empty',
        hash: '#inspect=ui-card--default',
        actions: [{ scroll: { role: 'heading', name: 'Pixel Changes', exact: true } }],
        wait: { text: 'No text record in the baseline. One is recorded at its next approval.' },
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
      {
        // Every entry decided, most rejected, with long ids: the summary's command is longer than
        // the dialog is wide.
        scenario: 'long-rejections',
        hash: '#overview',
        actions: [{ click: { role: 'button', name: 'Changed 0', exact: true } }],
        wait: { role: 'heading', name: 'Review complete' },
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
