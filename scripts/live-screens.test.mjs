// The live screens (scripts/live/): their ids, the response scrub's strictness, the guards, and the
// coverage ratchet: every server route the dashboard calls is covered by a flow or listed, with a
// reason, in UNCOVERED, a list that may only shrink.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FEATURES, STEPS, UNCOVERED } from './live/flows.mjs';
import { liveCatalogue } from './live/run.mjs';
import { assertSafeUrl } from './live/server.mjs';
import { FIXED_MS, routeOf, scrubber } from './live/volatile.mjs';
import { wantsLive } from './screens-container.mjs';
import { screenEntries } from './screens-check.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
/** L1's list (2026-11-03): UNCOVERED may only lose entries. */
const UNCOVERED_AT_L1 = [
  'approve-story',
  'a11y-accept',
  'a11y-reject',
  'a11y-unreview',
  'a11y-unaccept',
  'repair',
];

test('24 live screens: every step in both themes, ids live--<flow>-<n>@<theme>', () => {
  const e = screenEntries(
    liveCatalogue(),
    (id, section) => `.pxsig/baselines/${section}/${id}.psig`,
    () => 'scripts/live/flows.mjs'
  );
  assert.equal(e.length, 24);
  assert.ok(e.every((x) => /^live--[a-z-]+-\d+@(dark|light)$/.test(x.id)));
  assert.ok(e.every((x) => x.sig.startsWith('.pxsig/baselines/live/')));
  assert.deepEqual(
    e.filter((x) => x.mode === 'dark').map((x) => x.id.replace('@dark', '')),
    [
      'live--open-1',
      'live--approve-1',
      'live--approve-2',
      'live--approve-3',
      'live--reject-1',
      'live--undo-1',
      'live--recheck-1',
      'live--check-all-1',
      'live--changed-1',
      'live--changed-2',
      'live--read-only-1',
      'live--offline-1',
    ]
  );
});

test('each feature numbers its steps 1, 2, … with no gap, and every step has a feature', () => {
  for (const f of FEATURES) {
    const ns = STEPS.filter((s) => s.feature === f.id).map((s) => s.n);
    assert.deepEqual(
      [...ns].sort((a, b) => a - b),
      ns.map((_, i) => i + 1),
      f.id
    );
  }
  assert.ok(STEPS.every((s) => FEATURES.some((f) => f.id === s.feature)));
});

test('the scrub rewrites what varies, and keeps the order of a displayed time', () => {
  const sc = scrubber();
  const data = (/** @type {string} */ at) => ({
    generatedAt: at,
    check: {
      generatedAt: at,
      rows: [{ checkedAt: at, renderMs: 812 }],
      summary: { renderWallMs: 1, rustEngineMs: 2, totalMs: 3 },
    },
    history: [{ at, summary: { elapsedMs: 4 } }],
    storybook: { baseUrl: 'http://127.0.0.1:52601' },
    integrity: null,
  });
  const a = data('2026-11-04T02:40:38.573Z');
  const b = data('2026-11-04T02:41:00.000Z');
  assert.deepEqual(sc.scrub('data', a), []);
  assert.deepEqual(sc.scrub('data', b), []);
  assert.equal(a.check.generatedAt, '2026-10-25T11:01:00.000Z');
  assert.equal(b.check.generatedAt, '2026-10-25T11:02:00.000Z');
  assert.equal(a.check.rows[0].checkedAt, '2026-10-25T12:00:00.000Z');
  assert.equal(a.check.rows[0].renderMs, FIXED_MS);
  assert.equal(a.storybook.baseUrl, 'http://127.0.0.1:1');
});

test('the scrub is strict: a missing field and a leftover time, port or duration fail', () => {
  const sc = scrubber();
  const problems = sc.scrub('data', {
    generatedAt: '2026-11-04T02:40:38.573Z',
    check: { summary: { renderWallMs: 1, rustEngineMs: 2, totalMs: 3 }, rows: [] },
    history: [],
    storybook: { baseUrl: 'http://127.0.0.1:52601' },
    review: { x: { at: '2026-11-04T02:40:38.573Z' } },
    other: { when: '2026-11-04T02:40:38.573Z', link: 'see http://127.0.0.1:52600/x', waitMs: 9 },
  });
  assert.deepEqual(problems, [
    'data: check.generatedAt is missing',
    'data: other.when holds a time no rule rewrites',
    'data: other.link holds a server address with its port',
    'data: other.waitMs is a duration no rule rewrites',
  ]);
  assert.deepEqual(sc.scrub('status', { dashboard: 42 }), ['status: dashboard is not a URL']);
});

test('only the answers with something volatile are routed through the scrub', () => {
  assert.equal(routeOf('http://127.0.0.1:5/__pxsig/data?project=x'), 'data');
  assert.equal(routeOf('http://127.0.0.1:5/__pxsig/status'), 'status');
  assert.equal(routeOf('http://127.0.0.1:5/__pxsig/events'), null);
  assert.equal(routeOf('http://127.0.0.1:5/p/x/renders/latest/a.png'), null);
});

test("a person's own servers are never talked to", () => {
  assert.throws(() => assertSafeUrl('http://127.0.0.1:6070'), /refusing/);
  assert.throws(() => assertSafeUrl('http://127.0.0.1:6006/x'), /refusing/);
  assert.throws(() => assertSafeUrl('http://example.com:5000'), /refusing/);
  assert.equal(assertSafeUrl('http://127.0.0.1:52600'), 'http://127.0.0.1:52600');
});

test('the container stages the live workspace only when live screens run', () => {
  assert.equal(wantsLive([]), true);
  assert.equal(wantsLive(['--no-live']), false);
  assert.equal(wantsLive(['--only', 'inspector.header']), false);
  assert.equal(wantsLive(['--only', 'inspector.header,live.open']), true);
});

/** Every `/__pxsig/<route>` the dashboard's source names, `${action}` expanded from its union. */
function dashboardRoutes() {
  /** @type {Set<string>} */
  const routes = new Set();
  const walk = (/** @type {string} */ dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) {
        const text = readFileSync(p, 'utf8');
        for (const m of text.matchAll(/\/__pxsig\/([a-z0-9-]*)(\$\{action\})?/g)) {
          if (!m[2]) {
            if (m[1]) routes.add(m[1]);
            continue;
          }
          // The `action` parameter's union, declared before the template that uses it.
          const decl = [
            ...text.slice(0, m.index).matchAll(/action:\s*((?:'[a-z-]+'\s*\|?\s*)+)/g),
          ].at(-1);
          assert.ok(decl, `${n}: /__pxsig/${m[1]}\${action} with no union to expand`);
          for (const a of decl[1].matchAll(/'([a-z-]+)'/g)) routes.add(`${m[1]}${a[1]}`);
        }
      }
    }
  };
  walk(join(repo, 'packages', 'dashboard', 'src'));
  return routes;
}

test('coverage ratchet: every route the dashboard calls is covered by a flow or listed', () => {
  const routes = dashboardRoutes();
  const covered = new Set(FEATURES.flatMap((f) => f.covers));
  for (const r of ['data', 'status', 'session', 'approve', 'check']) assert.ok(routes.has(r), r);
  const missing = [...routes].filter((r) => !covered.has(r) && !(r in UNCOVERED));
  assert.deepEqual(missing, [], 'a dashboard route no live flow covers: add a step, or list it');
  for (const r of Object.keys(UNCOVERED)) {
    assert.ok(!covered.has(r), `${r} is covered now: take it off UNCOVERED`);
    assert.ok(routes.has(r), `${r} is no longer called by the dashboard: take it off UNCOVERED`);
    assert.ok(UNCOVERED_AT_L1.includes(r), `${r}: UNCOVERED may only shrink`);
    assert.ok(UNCOVERED[r].length > 10, `${r}: say why it is not covered`);
  }
});
