// A deployed Storybook's panel: which mode a page gets, and what the read-only snapshot shows.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  envText,
  headerText,
  isLocalHost,
  noSnapshotText,
  panelMode,
  parseSnapshot,
  prText,
  storyView,
} from '../snapshot-view.mjs';

const snap = {
  format: 'pxsig-snapshot',
  version: 1,
  generatedAt: '2026-10-27T20:00:00.000Z',
  commit: 'e8b417d1b2fd',
  shallow: false,
  uncommitted: false,
  projects: {
    ui: {
      stories: {
        'components-tabs--default': {
          entries: [
            {
              id: 'components-tabs--default',
              mode: 'dark',
              state: null,
              baseline: true,
              approved: {
                at: '2026-10-25T02:03:15.421Z',
                event: 'approved',
                pr: 137,
                commit: 'a2041a647c35',
                kind: 'colour',
                reason: 'tab border',
              },
              env: { browser: 'chromium 141', os: 'linux x64', container: 'pxsig:0.5.1-pw1.58.2' },
              a11y: ['color-contrast'],
            },
            {
              id: 'components-tabs--default__hover@light',
              mode: 'light',
              state: 'hover',
              baseline: false,
              approved: null,
              env: null,
              a11y: [],
            },
          ],
          history: [
            {
              at: '2026-10-25T02:03:15.421Z',
              event: 'approved',
              pr: 137,
              commit: 'a2041a647c35',
              kind: 'colour',
              reason: 'tab border',
              entries: 2,
            },
            {
              at: '2026-10-19T01:13:12.261Z',
              event: 'migrated',
              pr: null,
              commit: null,
              kind: null,
              reason: null,
              entries: 2,
            },
          ],
        },
      },
    },
  },
};

test('only a page served from this computer talks to a pxsig server', () => {
  for (const h of ['localhost', '127.0.0.1', '[::1]', 'LOCALHOST']) assert.ok(isLocalHost(h), h);
  for (const h of ['uat.example.com', '10.0.0.5', 'storybook.internal', '', undefined])
    assert.ok(!isLocalHost(h), String(h));
  assert.equal(panelMode({ hostname: 'localhost' }), 'live');
  assert.equal(panelMode({ hostname: 'uat.example.com' }), 'snapshot');
  assert.equal(
    panelMode({ hostname: 'uat.example.com', override: 'http://127.0.0.1:6070' }),
    'live',
    'the localStorage override still forces a connection'
  );
});

test('a snapshot is used only when it is one, of a version this panel reads', () => {
  assert.equal(parseSnapshot(snap), snap);
  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot({ format: 'pxsig-snapshot', version: 2, projects: {} }), null);
  assert.equal(parseSnapshot({ hello: 1 }), null);
});

test('the story view: coverage per mode and state, then history', () => {
  const v = storyView(snap, 'components-tabs--default');
  assert.deepEqual(v.entries[0], {
    mode: 'dark',
    baseline: 'yes',
    last: '2026-10-25 approved',
    pr: '#137',
    change: 'colour',
    env: 'chromium 141 · linux x64 · pxsig:0.5.1-pw1.58.2',
    a11y: 'color-contrast',
  });
  assert.equal(v.entries[1].mode, 'light · hover');
  assert.equal(v.entries[1].baseline, 'none');
  assert.equal(v.entries[1].last, 'not logged');
  assert.equal(v.entries[1].a11y, 'none accepted');
  assert.equal(v.history.length, 2);
  assert.equal(v.history[0].reason, 'tab border');
  assert.equal(v.history[1].pr, 'not committed');
  assert.equal(storyView(snap, 'components-other--x'), null);
});

test('PR, environment and header say why something is missing', () => {
  assert.equal(prText({ pr: null, commit: 'abc' }, snap), 'no PR');
  assert.equal(prText({ pr: null, commit: null }, snap), 'not committed');
  assert.equal(prText({ pr: null, commit: null }, { ...snap, shallow: true }), 'not known');
  assert.equal(envText(null), 'not recorded');
  assert.equal(headerText(snap), 'pxsig · read-only · built from e8b417d1b2fd, 2026-10-27');
  assert.match(
    headerText({ ...snap, uncommitted: true, shallow: true }),
    /uncommitted changes · PRs not known/
  );
});

test('with no snapshot, the panel says where pxsig runs and that nothing connects', () => {
  const t = noSnapshotText('uat.example.com');
  assert.match(t.title, /not connected/);
  assert.match(t.body, /uat\.example\.com/);
  assert.match(t.body, /makes no connection/);
});
