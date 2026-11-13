/** The inspector and embed features (features.ts). */
import type { Feature } from '../features.ts';

export const INSPECTOR: Feature[] = [
  {
    id: 'inspector.header',
    section: 'inspector',
    title: 'Inspector header',
    purpose:
      "The entry id, its context and reasons, its verdict, its other modes and states, the position in the list, the review buttons and Close. Reject opens a row under the header for an optional reason (one line, at most 280 characters; `rejections.note.ask: false` rejects at once). A rejected entry's note gives its reason, the re-check command, Edit reason and Copy for an agent (one paragraph for an assistant); an entry checked again since its rejection shows Rejected earlier with Dismiss reason; a reason or packet the server did not keep says so.",
    states: {
      static: 'No review buttons.',
      readOnly:
        'A note under the header gives the command for a dashboard link, with a copy button; Reject, Approve and Undo stay in place, disabled.',
    },
    interactions: [
      { action: 'Approve or reject (accept, in an accessibility session)', keys: 'A / R' },
      { action: 'Reject with the reason typed, or none; cancel the reason', keys: 'Enter / Esc' },
      { action: 'Edit reason, copy for an agent, dismiss an earlier reason' },
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
      'inspector.a11yRejectedNote',
      'inspector.rejection',
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
      'TextField',
    ],
    files: [
      'inspector/Inspector',
      'inspector/Header',
      'inspector/controls',
      'parts/StatusOf',
      'inspector/RejectNote',
      'inspector/RejectedNote',
      'inspector/side/A11ySection',
    ],
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
      {
        // Reject opens the reason's row, empty, under the header.
        scenario: 'changed',
        hash: '#inspect=ui-button--primary',
        actions: [{ click: { role: 'button', name: 'Reject', exact: true } }],
        wait: { role: 'textbox', name: 'Reason' },
      },
      {
        scenario: 'rejected',
        hash: '#inspect=ui-button--primary',
        wait: { text: 'Rejected. Reason: The label sits 4px lower than in the baseline' },
      },
      {
        // Checked again since its rejection: it still differs, its reason open.
        scenario: 'rejected',
        hash: '#inspect=ui-button--primary@light',
        wait: { role: 'button', name: 'Dismiss reason', exact: true },
      },
      {
        // The side panel's Accessibility Reject opens the reason's row for the violations; then the
        // side panel back at its top (the click scrolled it to the section), as it opens. Here,
        // not in inspector.details: the row moves the side panel down, and its box is locked there.
        scenario: 'a11y',
        hash: '#inspect=ui-button--primary',
        actions: [
          {
            click: {
              role: 'button',
              name: 'Reject',
              exact: true,
              within: { role: 'complementary' },
            },
          },
          { scroll: { role: 'heading', name: 'Pixel', exact: true } },
        ],
        wait: { role: 'group', name: 'Reject the violations with a reason' },
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
      { action: 'Copy a file path; open a file, a rejection packet or the story in Storybook' },
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
    id: 'inspector.masks',
    section: 'inspector',
    title: 'Masks',
    purpose:
      "The masks on the entry's render (`data-volatile` elements, a story's `ignore`, `capture.ignore` of the project or workspace): in the side panel, after Pixel Changes, a Masks section with each mask's selector, where it came from, its reason and its share of the capture; when the masks changed since the baseline, Added, Removed, Grew, Count changed or Moved and both shares; masks no approval passes (over 50% of the capture together, on the story root, or a data-volatile with no reason or on a container) say so first, with the reasons and what to do about each, also when no mask was painted; such an entry is Blocked, with no Reject or Approve: the same line is in their place. A masks-only change (the masks failed the entry and no pixel differs) says so in the change stepper and Pixel Changes, and puts the Masks section first. In the header and on the entry's card, Masks changed and Large mask (all of the entry's masks together over 25% of the capture, a warning); Overview lists the entries with a large mask while there are any, and Review Stories filters them.",
    states: {},
    interactions: [{ action: 'Open the entries with a large mask from Open items' }],
    copy: [
      'inspector.sections.masks',
      'inspector.masks',
      'inspector.nav.masksOnly',
      'inspector.changes.masksOnly',
      'review.card.masksChanged',
      'review.card.largeMask',
      'review.card.largeMaskTitle',
      'review.filters.masks',
      'overview.items.masks',
    ],
    components: ['Badge'],
    files: [
      'inspector/masks',
      'inspector/side/MasksSection',
      'inspector/side/Side',
      'parts/MaskBadges',
      'inspector/Header',
      'parts/StoryGrid',
    ],
    screens: [
      {
        // The Masks section is below the side panel's fold: Pixel Changes, just above it, scrolled
        // to the panel's top, so both show.
        scenario: 'masks',
        hash: '#inspect=ui-activity-row--default',
        actions: [{ scroll: { role: 'heading', name: 'Pixel Changes', exact: true } }],
        wait: { role: 'heading', name: 'Masks', exact: true },
      },
      {
        scenario: 'masks',
        hash: '#overview',
        wait: { text: 'Entries with masks over 25%', exact: true },
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
      { action: "Copy the rejected entries' reasons for an agent" },
      { action: 'Back to the overview, view the rejected, or keep browsing' },
    ],
    copy: ['inspector.session', 'inspector.rejection.copyPrompt'],
    components: [
      'Progress',
      'Dialog',
      'DialogTitle',
      'KeyValueList',
      'KeyValueItem',
      'CopyValue',
      'Button',
    ],
    files: ['inspector/Inspector', 'inspector/SessionSummary', 'inspector/RejectedNote'],
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
    components: ['Switch', 'IconButton', 'SegmentedChoice', 'TextField'],
    files: [
      'App',
      'inspector/Inspector',
      'inspector/controls',
      'inspector/side/ViewSection',
      'inspector/RejectNote',
    ],
    screens: [
      {
        scenario: 'changed',
        query: 'embed=1&story=ui-button--primary',
        wait: { role: 'group', name: 'Image comparison' },
      },
      {
        // Reject in the panel opens the reason's row; typing in it decides nothing.
        scenario: 'changed',
        query: 'embed=1&story=ui-button--primary',
        actions: [{ click: { role: 'button', name: 'Reject', exact: true } }],
        wait: { role: 'textbox', name: 'Reason' },
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
