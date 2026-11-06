/**
 * live/flows.mjs — the live screens' catalogue: the reviewer's flows through the real `pxsig serve`
 * (scripts/live/run.mjs), on the staged examples/single-package (scripts/live/stage.mjs).
 *
 * The run starts with 9 entries passing and 3 new (`components-badge--{danger,neutral,success}@dark`;
 * `@dark` there is the example's mode, not the dashboard's theme). The steps run in this order on
 * one page; each ends at its landmark and is one screen, `live--<flow>-<n>@<theme>`, in each theme.
 * An id is a baseline: a step is never renumbered; a new step takes the next number or a new flow.
 *
 * A step's actions: `{ click }` and `{ press }` as in fixtures/screens.json, and the live ones:
 * `{ link: '#hash' }` open a fresh dashboard link (the ticket traded by the page) · `{ cli: [...] }`
 * run the pxsig CLI in the staged folder, against this server · `{ change: true }` the scripted
 * change (Badge.jsx written, Storybook swapped for the "after" build) · `{ react: true }` the
 * scripted React change (Badge reads a ref during render: the compiler skips it, nothing drawn
 * changes) · `{ readOnly: '#hash' }` the page of a second browser context without the link's
 * cookie · `{ stop: true }` stop the server. After every action the run waits until the server is
 * idle (scripts/live/server.mjs), except after a `{ click, busy: true }` (a run to cancel).
 *
 * `covers`: the server routes (`/__pxsig/<route>`) a flow's page or CLI calls exercise. The coverage
 * ratchet (scripts/live-screens.test.mjs) fails when the dashboard calls a route no flow covers and
 * UNCOVERED does not list: that list may only shrink.
 */

/** @import { LiveFeature, LiveStep } from './types.js' */

/** The inspector's decision buttons and Close: in one place on every screen that shows them. */
const DECISION_ANCHORS = [
  { name: 'reject', target: { role: 'button', name: 'Reject', exact: true } },
  { name: 'approve', target: { role: 'button', name: 'Approve', exact: true } },
  { name: 'close', target: { role: 'button', name: 'Close', exact: true } },
];
const heading = (/** @type {string} */ name) => ({ role: 'heading', name, exact: true });

/** @type {LiveFeature[]} */
export const FEATURES = [
  {
    id: 'live.open',
    title: 'Open the dashboard link',
    purpose: 'A fresh link opens Overview; the page trades its ticket and can approve.',
    covers: ['data', 'projects', 'status', 'events', 'session', 'ticket'],
  },
  {
    id: 'live.approve',
    title: 'Approve new entries',
    purpose: "Start review on the new entries, approve one after another, the session's end.",
    covers: ['approve'],
    anchors: DECISION_ANCHORS,
  },
  {
    id: 'live.reject',
    title: 'Reject an entry',
    purpose: 'Reject moves on; back on the entry, its Rejected note and Undo.',
    covers: ['reject'],
  },
  {
    id: 'live.undo',
    title: 'Undo a decision',
    purpose: 'Undo takes the rejection back: the entry is new again.',
    covers: ['unreview'],
  },
  {
    id: 'live.recheck',
    title: 'Re-check one entry',
    purpose: "The inspector's Re-check renders the entry again on the server; it stays new.",
    covers: ['check'],
  },
  {
    id: 'live.check-all',
    title: 'Check everything from a terminal',
    purpose: '`pxsig check --full` beside the server queues every entry there; Overview follows.',
    covers: ['check'],
  },
  {
    id: 'live.changed',
    title: 'A changed component',
    purpose:
      'A real source change re-rendered: two entries change; the inspector shows real renders.',
    covers: ['check'],
    anchors: DECISION_ANCHORS,
  },
  {
    id: 'live.react',
    title: 'React analysis and render counts',
    purpose:
      'Analyse finds the component the React Compiler now skips; Measure renders counts renders in a visual check; Cancel stops one part way.',
    covers: ['react', 'check'],
  },
  {
    id: 'live.read-only',
    title: 'Without the link',
    purpose: 'A browser that did not open the dashboard link reads only.',
    covers: ['status'],
  },
  {
    id: 'live.offline',
    title: 'The server stops',
    purpose: 'The inspector closed, the server stops: the page keeps its data and says Offline.',
    covers: ['events'],
  },
];

/** @type {LiveStep[]} in the order they run */
export const STEPS = [
  {
    feature: 'live.open',
    n: 1,
    actions: [{ link: '#overview' }],
    wait: { text: 'Can approve', exact: true },
  },
  {
    feature: 'live.approve',
    n: 1,
    actions: [{ click: { role: 'button', name: 'Approve 3 new entries' } }],
    wait: heading('components-badge--danger@dark'),
  },
  {
    feature: 'live.approve',
    n: 2,
    actions: [{ click: { role: 'button', name: 'Approve', exact: true } }],
    wait: heading('components-badge--neutral@dark'),
  },
  {
    feature: 'live.reject',
    n: 1,
    actions: [
      { click: { role: 'button', name: 'Reject', exact: true } },
      { click: { role: 'button', name: 'Previous story (←)' } },
    ],
    wait: { text: 'Rejected. Fix the component' },
  },
  {
    feature: 'live.undo',
    n: 1,
    actions: [{ click: { role: 'button', name: 'Undo', exact: true } }],
    wait: { text: '1 of 3 reviewed' },
  },
  {
    feature: 'live.recheck',
    n: 1,
    actions: [{ click: { role: 'button', name: 'Re-check', exact: true } }],
    wait: heading('components-badge--neutral@dark'),
  },
  {
    feature: 'live.approve',
    n: 3,
    actions: [
      { click: { role: 'button', name: 'Approve', exact: true } },
      { click: { role: 'button', name: 'Approve', exact: true } },
    ],
    wait: heading('Review complete'),
  },
  {
    feature: 'live.check-all',
    n: 1,
    actions: [
      { click: { role: 'button', name: 'Back to overview' } },
      { cli: ['check', '--full'] },
    ],
    wait: { role: 'button', name: 'Changed 0' },
  },
  {
    feature: 'live.changed',
    n: 1,
    actions: [{ change: true }, { cli: ['check', '--full'] }],
    wait: { role: 'button', name: 'Changed 2' },
  },
  {
    feature: 'live.changed',
    n: 2,
    actions: [{ link: '#overview' }, { click: { role: 'button', name: 'Start review' } }],
    wait: { role: 'heading', name: 'components-badge--success' },
  },
  {
    feature: 'live.react',
    n: 1,
    actions: [
      { react: true },
      { link: '#react' },
      { click: { role: 'button', name: 'Analyse', exact: true } },
    ],
    wait: { text: 'Newly skipped', exact: true },
  },
  {
    feature: 'live.react',
    n: 2,
    actions: [
      { click: { role: 'button', name: 'Renders', exact: true } },
      { click: { role: 'button', name: 'Measure renders', exact: true } },
    ],
    wait: { text: 'Renders measured: 12 entries' },
  },
  {
    feature: 'live.react',
    n: 3,
    // Cancel while the first entry of each story file renders: those two keep their new results.
    actions: [
      { click: { role: 'button', name: 'Measure renders', exact: true }, busy: true },
      { click: { role: 'button', name: 'Cancel', exact: true } },
    ],
    wait: { text: 'Measurement cancelled after' },
  },
  {
    feature: 'live.read-only',
    n: 1,
    actions: [{ readOnly: '#overview' }],
    wait: { text: 'Read only', exact: true },
  },
  {
    feature: 'live.offline',
    n: 1,
    actions: [{ click: { role: 'button', name: 'Close', exact: true } }, { stop: true }],
    wait: { text: 'Offline', exact: true },
  },
];

/**
 * Server routes the dashboard calls that no flow covers yet, each with its reason (the coverage
 * ratchet: this list may only shrink).
 * @type {Record<string, string>}
 */
export const UNCOVERED = {
  'approve-story': 'a later flow: approving a whole story (approvals.byStory is off by default)',
  'a11y-accept': 'a later flow, live.a11y: the example has no accessibility violation to decide',
  'a11y-reject': 'a later flow, live.a11y',
  'a11y-unreview': 'a later flow, live.a11y',
  'a11y-unaccept': 'a later flow, live.a11y',
  repair: 'a later flow, live.repair: the staged store has nothing to repair',
};
