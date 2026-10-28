/**
 * pxsig in Storybook: a "PXSIG: Visual regression" panel and sidebar status dots.
 *
 * Thin client of the pxsig server (`pxsig serve`). Where it is comes from the preset (see
 * preset.cjs): the `server` option, the running server's address, or the configured port; a
 * `pxsig-server` key in localStorage overrides them all.
 * - the panel embeds the dashboard's inspector for the current story
 *   (`/report/?embed=1&story=<id>`) — one inspector, built on the design system;
 * - Check story / Check all queue renders + Rust checks on the server's warm pool;
 * - statuses come from `/__pxsig/status` and refresh on the server's event stream,
 *   so `pxsig serve --watch` re-checks an edited component and the dots update live.
 * - one server can hold several projects; the server works out which one owns a story.
 * - on a Storybook not served from this computer (deployed to dev, UAT, pre-prod) none of the
 *   above: no request to any pxsig server, no sidebar dots; the panel shows the read-only snapshot
 *   `storybook build` wrote beside it (`pxsig-snapshot.json`, see preset.cjs), or says there is none.
 *
 * Status mapping: pass / drift / approved → success · changed / flaky / new → warning (needs review:
 * an expected change is not a failure) · rejected / error → error · unaffected → unknown.
 * Statuses go to Storybook's status store (`experimental_getStatusStore`, Storybook 9+).
 * Integrity (the server's ledger, lib/integrity.mjs) escalates a story: an error-severity code
 * (unregistered, never-checked, missing-baseline-image, render-error) turns its dot red, and a
 * story with no coverage at all gets one — so a gap shows without anyone opening the panel.
 */
import React from 'react';
import {
  addons,
  experimental_getStatusStore,
  types,
  useStorybookState,
} from 'storybook/manager-api';
import { AddonPanel } from 'storybook/internal/components';
import { useTheme } from 'storybook/theming';
import { buttonStyle, dashboardUrl, panelColors, themeMode } from './panel-style.mjs';
import {
  headerText,
  noSnapshotText,
  panelMode,
  parseSnapshot,
  SNAPSHOT_FILE,
  storyView,
} from './snapshot-view.mjs';
/** @import { CheckEvent, PanelState, ServerStatus, Snapshot, StatusLevel } from './types.js' */

const ADDON = 'pxsig';
const PANEL = `${ADDON}/panel`;
// The localStorage value joins only when it is set: every candidate is a string.
const CANDIDATES = /** @type {string[]} */ ([
  ...(typeof window !== 'undefined' && window.localStorage?.getItem('pxsig-server')
    ? [window.localStorage.getItem('pxsig-server')]
    : []),
  ...((typeof window !== 'undefined' && window.__PXSIG__?.servers) || []),
  'http://127.0.0.1:6070',
]);
let SERVER = CANDIDATES[0];
// A Storybook not served from this computer (a deployed one) makes no request to any pxsig server:
// the panel reads the read-only snapshot its build wrote beside it (snapshot-view.mjs).
const MODE =
  typeof window === 'undefined'
    ? 'live'
    : panelMode({
        hostname: window.location.hostname,
        override: window.localStorage?.getItem('pxsig-server') ?? null,
      });
/**
 * The first candidate that answers; kept until it stops answering.
 * @returns {Promise<ServerStatus>}
 */
async function status() {
  for (const url of [SERVER, ...CANDIDATES.filter((c) => c !== SERVER)]) {
    try {
      const r = await fetch(`${url}/__pxsig/status`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) continue;
      SERVER = url;
      // The pxsig server's `GET /__pxsig/status` answer (docs/server.md).
      return /** @type {ServerStatus} */ (await r.json());
    } catch {
      // try the next candidate
    }
  }
  throw new Error('no pxsig server');
}
/** @type {Record<string, StatusLevel>} */
const STATUS = {
  pass: 'success',
  drift: 'success',
  approved: 'success',
  flaky: 'warning',
  changed: 'warning',
  new: 'warning',
  rejected: 'error',
  error: 'error',
  skipped: 'unknown',
};
/** @type {Record<string, StatusLevel>} */
const SEV = { error: 'error', warn: 'warning', info: 'success' };
const statusStore = experimental_getStatusStore(ADDON);
const codesText = (/** @type {Record<string, number> | undefined} */ codes) =>
  Object.entries(codes ?? {})
    .filter(([c]) => !['drift', 'ok'].includes(c))
    .map(([c, n]) => `${n} ${c}`)
    .join(', ');

// One shared connection: the panel subscribes to the same events the status updater uses.
const bus = new EventTarget();
/** @type {PanelState} */
let state = { up: false, running: false, stories: {}, integrity: {}, integritySummary: null };
const emit = () => bus.dispatchEvent(new Event('change'));

addons.register(ADDON, () => {
  const refresh = async () => {
    try {
      const s = await status();
      state = {
        ...state,
        up: true,
        running: s.running,
        stories: s.stories,
        integrity: s.integrity ?? {},
        integritySummary: s.integritySummary ?? null,
      };
      /** @type {Record<string, { status: StatusLevel, title: string, description: string }>} */
      const update = {};
      for (const [id, st] of Object.entries(s.stories)) {
        update[id] = {
          status: STATUS[st.status] ?? 'unknown',
          title: `pxsig: ${st.status}`,
          description: st.entries
            .map((e) => `${e.mode}: ${e.state}${e.ssim != null ? ` · ssim ${e.ssim}` : ''}`)
            .join('\n'),
        };
      }
      for (const [id, ig] of Object.entries(state.integrity)) {
        if (ig.severity !== 'error' && update[id]) continue;
        if (ig.severity === 'info' && !update[id]) continue;
        update[id] = {
          status: SEV[ig.severity] ?? 'unknown',
          title: `pxsig integrity: ${ig.status}`,
          description: `${codesText(ig.codes)}${update[id] ? `\n${update[id].description}` : ''}`,
        };
      }
      // Replace, not merge: a story the server no longer reports loses its dot.
      statusStore.unset();
      statusStore.set(
        Object.entries(update).map(([storyId, u]) => ({
          storyId,
          typeId: ADDON,
          value: `status-value:${u.status}`,
          title: u.title,
          description: u.description,
        }))
      );
    } catch {
      state = { ...state, up: false };
    }
    emit();
  };
  /** @type {EventSource | null} */
  let es = null;
  const connect = () => {
    try {
      es = new EventSource(`${SERVER}/__pxsig/events`);
      es.addEventListener('hello', refresh);
      es.addEventListener('data', refresh);
      es.addEventListener('review', refresh);
      es.addEventListener('integrity', refresh);
      es.addEventListener('check', (/** @type {MessageEvent<string>} */ e) => {
        // The server's `check` event (docs/server.md).
        const d = /** @type {CheckEvent} */ (JSON.parse(e.data));
        state = { ...state, running: d.state === 'running', last: d };
        emit();
      });
      es.onerror = () => {
        // The handler of the source just opened: es is that source.
        /** @type {EventSource} */ (es).close();
        state = { ...state, up: false };
        emit();
        setTimeout(connect, 5000);
      };
    } catch {
      setTimeout(connect, 5000);
    }
  };
  if (MODE === 'live') {
    void refresh();
    connect();
  }

  addons.add(PANEL, {
    type: types.PANEL,
    title: 'PXSIG: Visual regression',
    paramKey: 'pxsig',
    render: ({ active }) =>
      React.createElement(
        AddonPanel,
        // The panel goes in as createElement's third argument (React's types want it in props).
        /** @type {{ active: boolean, children: React.ReactElement }} */ ({ active: !!active }),
        React.createElement(MODE === 'live' ? Panel : SnapshotPanel)
      ),
  });
});

const h = React.createElement;

function Panel() {
  const { storyId } = useStorybookState();
  // Storybook's theme: the buttons follow it, and the inspector and dashboard open in its mode.
  const theme = useTheme();
  const mode = themeMode(theme);
  const colors = panelColors(theme);
  /**
   * @param {string} label
   * @param {() => void} onClick
   * @param {boolean} [disabled]
   */
  const btn = (label, onClick, disabled) =>
    h('button', { type: 'button', onClick, disabled, style: buttonStyle(theme, disabled) }, label);
  const [, force] = React.useReducer((/** @type {number} */ n) => n + 1, 0);
  React.useEffect(() => {
    bus.addEventListener('change', force);
    return () => bus.removeEventListener('change', force);
  }, []);
  const post = (/** @type {{ story?: string, all?: boolean }} */ body) =>
    fetch(`${SERVER}/__pxsig/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  const st = state.stories[storyId];
  const ig = state.integrity[storyId];
  if (!state.up)
    return h(
      'div',
      { style: { padding: 16, fontSize: 13, lineHeight: 1.6, color: colors.text } },
      h('strong', null, 'The pxsig server is not running.'),
      h('div', null, 'Start it from the repo root, then this panel connects on its own:'),
      h('code', { style: { display: 'block', marginTop: 8 } }, 'npx pxsig serve --watch')
    );
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        color: colors.text,
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '6px 10px',
          borderBottom: `1px solid ${colors.border}`,
          fontSize: 12,
        },
      },
      h('strong', null, st ? `pxsig: ${st.status}` : 'pxsig: no result yet'),
      st
        ? h(
            'span',
            { style: { opacity: 0.7 } },
            st.entries.map((e) => `${e.mode} ${e.state}`).join(' · ')
          )
        : null,
      ig && ig.status !== 'ok'
        ? h(
            'span',
            {
              title: codesText(ig.codes),
              style: {
                padding: '1px 6px',
                borderRadius: 3,
                fontSize: 11,
                color: ig.severity === 'error' ? '#fff' : 'inherit',
                background:
                  ig.severity === 'error'
                    ? '#c62828'
                    : ig.severity === 'warn'
                      ? 'rgba(240,160,0,.25)'
                      : 'rgba(128,128,128,.2)',
              },
            },
            `integrity: ${ig.status}${codesText(ig.codes) ? ` (${codesText(ig.codes)})` : ''}`
          )
        : null,
      h('span', { style: { flex: 1 } }),
      state.running ? h('span', { style: { opacity: 0.7 } }, 'Checking…') : null,
      btn('Check story', () => post({ story: storyId }), state.running),
      btn('Check all', () => post({ all: true }), state.running),
      btn('Open dashboard', () =>
        window.open(
          dashboardUrl(
            SERVER,
            {
              project: st?.project ?? null,
              story: storyId,
              hash: `inspect=${encodeURIComponent(st?.entries[0]?.id ?? storyId)}`,
            },
            mode
          ),
          '_blank'
        )
      )
    ),
    h('iframe', {
      key: `${storyId}:${mode}`,
      title: 'pxsig inspector',
      src: dashboardUrl(SERVER, { embed: 1, story: storyId }, mode),
      style: { flex: 1, minHeight: 0, border: 0, width: '100%' },
    })
  );
}

/** The snapshot beside this Storybook, fetched once, when the panel first shows: null when absent. */
/** @type {Promise<Snapshot | null> | null} */
let snapshotLoad = null;
const loadSnapshot = () =>
  (snapshotLoad ??= fetch(new URL(SNAPSHOT_FILE, document.baseURI), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then(parseSnapshot)
    .catch(() => null));

function SnapshotPanel() {
  const { storyId } = useStorybookState();
  const colors = panelColors(useTheme());
  const [snap, setSnap] = React.useState(/** @type {Snapshot | null | undefined} */ (undefined));
  React.useEffect(() => {
    void loadSnapshot().then(setSnap);
  }, []);
  const box = (/** @type {React.ReactNode[]} */ ...children) =>
    h(
      'div',
      {
        style: { padding: 16, fontSize: 13, lineHeight: 1.6, color: colors.text, overflow: 'auto' },
      },
      ...children
    );
  if (snap === undefined) return box(h('span', { style: { opacity: 0.7 } }, 'Loading…'));
  if (!snap) {
    const t = noSnapshotText(window.location.host);
    return box(h('strong', null, t.title), h('div', null, t.body));
  }
  const view = storyView(snap, storyId);
  /** @type {React.CSSProperties} */
  const cell = {
    padding: '4px 10px 4px 0',
    borderBottom: `1px solid ${colors.border}`,
    textAlign: 'left',
    verticalAlign: 'top',
  };
  /**
   * @param {[string, string][]} cols
   * @param {Record<string, string | number>[]} rows
   */
  const table = (cols, rows) =>
    h(
      'table',
      { style: { borderCollapse: 'collapse', width: '100%', fontSize: 12, marginBottom: 16 } },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          ...cols.map(([, label]) => h('th', { style: { ...cell, fontWeight: 600 } }, label))
        )
      ),
      h(
        'tbody',
        null,
        ...rows.map((r) =>
          h('tr', null, ...cols.map(([k]) => h('td', { style: cell }, String(r[k] ?? ''))))
        )
      )
    );
  return box(
    h('div', { style: { fontSize: 12, opacity: 0.7, marginBottom: 12 } }, headerText(snap)),
    ...(view
      ? [
          h('strong', null, 'Coverage'),
          table(
            [
              ['mode', 'Mode'],
              ['baseline', 'Baseline'],
              ['last', 'Last change'],
              ['pr', 'PR'],
              ['change', 'Change'],
              ['env', 'Environment'],
              ['a11y', 'Accessibility'],
            ],
            view.entries
          ),
          h('strong', null, 'History'),
          view.history.length
            ? table(
                [
                  ['at', 'Date'],
                  ['event', 'Event'],
                  ['pr', 'PR'],
                  ['change', 'Change'],
                  ['reason', 'Reason'],
                  ['entries', 'Entries'],
                ],
                view.history
              )
            : h('div', null, 'Nothing logged.'),
        ]
      : [h('div', null, 'No visual baseline for this story.')])
  );
}
