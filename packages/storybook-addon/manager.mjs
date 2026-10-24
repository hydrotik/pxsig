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
 *
 * Status mapping: pass / drift / approved → success · changed / flaky / new → warning (needs review:
 * an expected change is not a failure) · rejected / error → error · unaffected → unknown.
 * Statuses go to Storybook's status store (`experimental_getStatusStore`, Storybook 9+).
 * Integrity (the server's ledger, lib/integrity.mjs) escalates a story: an error-severity code
 * (unregistered, never-checked, missing-baseline-image, render-error) turns its dot red, and a
 * story with no coverage at all gets one — so a gap shows without anyone opening the panel.
 */
import React from 'react';
import { addons, experimental_getStatusStore, types, useStorybookState } from 'storybook/manager-api';
import { AddonPanel } from 'storybook/internal/components';
import { useTheme } from 'storybook/theming';
import { buttonStyle, dashboardUrl, panelColors, themeMode } from './panel-style.mjs';

const ADDON = 'pxsig';
const PANEL = `${ADDON}/panel`;
const CANDIDATES = [
  ...(typeof window !== 'undefined' && window.localStorage?.getItem('pxsig-server') ? [window.localStorage.getItem('pxsig-server')] : []),
  ...((typeof window !== 'undefined' && window.__PXSIG__?.servers) || []),
  'http://127.0.0.1:6070',
];
let SERVER = CANDIDATES[0];
/** The first candidate that answers; kept until it stops answering. */
async function status() {
  for (const url of [SERVER, ...CANDIDATES.filter((c) => c !== SERVER)]) {
    try {
      const r = await fetch(`${url}/__pxsig/status`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) continue;
      SERVER = url;
      return await r.json();
    } catch {
      // try the next candidate
    }
  }
  throw new Error('no pxsig server');
}
const STATUS = { pass: 'success', drift: 'success', approved: 'success', flaky: 'warning', changed: 'warning', new: 'warning', rejected: 'error', error: 'error', skipped: 'unknown' };
const SEV = { error: 'error', warn: 'warning', info: 'success' };
const statusStore = experimental_getStatusStore(ADDON);
const codesText = (codes) => Object.entries(codes ?? {}).filter(([c]) => !['drift', 'ok'].includes(c)).map(([c, n]) => `${n} ${c}`).join(', ');

// One shared connection: the panel subscribes to the same events the status updater uses.
const bus = new EventTarget();
let state = { up: false, running: false, stories: {}, integrity: {}, integritySummary: null };
const emit = () => bus.dispatchEvent(new Event('change'));

addons.register(ADDON, () => {
  const refresh = async () => {
    try {
      const s = await status();
      state = { ...state, up: true, running: s.running, stories: s.stories, integrity: s.integrity ?? {}, integritySummary: s.integritySummary ?? null };
      const update = {};
      for (const [id, st] of Object.entries(s.stories)) {
        update[id] = {
          status: STATUS[st.status] ?? 'unknown',
          title: `pxsig: ${st.status}`,
          description: st.entries.map((e) => `${e.mode}: ${e.state}${e.ssim != null ? ` · ssim ${e.ssim}` : ''}`).join('\n'),
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
        Object.entries(update).map(([storyId, u]) => ({ storyId, typeId: ADDON, value: `status-value:${u.status}`, title: u.title, description: u.description }))
      );
    } catch {
      state = { ...state, up: false };
    }
    emit();
  };
  let es = null;
  const connect = () => {
    try {
      es = new EventSource(`${SERVER}/__pxsig/events`);
      es.addEventListener('hello', refresh);
      es.addEventListener('data', refresh);
      es.addEventListener('review', refresh);
      es.addEventListener('integrity', refresh);
      es.addEventListener('check', (e) => {
        const d = JSON.parse(e.data);
        state = { ...state, running: d.state === 'running', last: d };
        emit();
      });
      es.onerror = () => {
        es.close();
        state = { ...state, up: false };
        emit();
        setTimeout(connect, 5000);
      };
    } catch {
      setTimeout(connect, 5000);
    }
  };
  refresh();
  connect();

  addons.add(PANEL, {
    type: types.PANEL,
    title: 'PXSIG: Visual regression',
    paramKey: 'pxsig',
    render: ({ active }) => React.createElement(AddonPanel, { active: !!active }, React.createElement(Panel)),
  });
});

const h = React.createElement;

function Panel() {
  const { storyId } = useStorybookState();
  // Storybook's theme: the buttons follow it, and the inspector and dashboard open in its mode.
  const theme = useTheme();
  const mode = themeMode(theme);
  const colors = panelColors(theme);
  const btn = (label, onClick, disabled) => h('button', { type: 'button', onClick, disabled, style: buttonStyle(theme, disabled) }, label);
  const [, force] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => {
    bus.addEventListener('change', force);
    return () => bus.removeEventListener('change', force);
  }, []);
  const post = (body) => fetch(`${SERVER}/__pxsig/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
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
    { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: colors.text } },
    h(
      'div',
      { style: { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderBottom: `1px solid ${colors.border}`, fontSize: 12 } },
      h('strong', null, st ? `pxsig: ${st.status}` : 'pxsig: no result yet'),
      st ? h('span', { style: { opacity: 0.7 } }, st.entries.map((e) => `${e.mode} ${e.state}`).join(' · ')) : null,
      ig && ig.status !== 'ok'
        ? h(
            'span',
            {
              title: codesText(ig.codes),
              style: { padding: '1px 6px', borderRadius: 3, fontSize: 11, color: ig.severity === 'error' ? '#fff' : 'inherit', background: ig.severity === 'error' ? '#c62828' : ig.severity === 'warn' ? 'rgba(240,160,0,.25)' : 'rgba(128,128,128,.2)' },
            },
            `integrity: ${ig.status}${codesText(ig.codes) ? ` (${codesText(ig.codes)})` : ''}`
          )
        : null,
      h('span', { style: { flex: 1 } }),
      state.running ? h('span', { style: { opacity: 0.7 } }, 'Checking…') : null,
      btn('Check story', () => post({ story: storyId }), state.running),
      btn('Check all', () => post({ all: true }), state.running),
      btn('Open dashboard', () => window.open(dashboardUrl(SERVER, { project: st?.project ?? null, story: storyId, hash: `inspect=${encodeURIComponent(st?.entries[0]?.id ?? storyId)}` }, mode), '_blank'))
    ),
    h('iframe', {
      key: `${storyId}:${mode}`,
      title: 'pxsig inspector',
      src: dashboardUrl(SERVER, { embed: 1, story: storyId }, mode),
      style: { flex: 1, minHeight: 0, border: 0, width: '100%' },
    })
  );
}
