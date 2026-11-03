// `pxsig doctor` right after the first `check --full` of a project whose Storybook is a build in
// `storybook.staticDir`: it reconciles against that build's index (not a static scan), points at
// reviewing the new entries (not at `--repair`), has no Settings row, and its verdict agrees with
// its exit. Temp folders only; nothing answers at storybook.url, no server.
import assert from 'node:assert/strict';
import { rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cli, tree } from './features-helpers.mjs';
import { CHECKER } from './fixture.mjs';

const ids = ['c-a--one', 'c-a--two'];

/**
 * A project after its first check: two entries rendered, NEW (no signature yet), and a Storybook
 * build in storybook-static/ that lists both stories.
 * @param {{ build?: boolean }} [opts]
 */
function firstRun({ build = true } = {}) {
  const now = new Date().toISOString();
  const root = tree({
    'pxsig.config.json': {
      name: 'first',
      storybook: { url: 'http://127.0.0.1:1', staticDir: 'storybook-static' },
    },
    'src/A/A.stories.tsx':
      "export default { title: 'C/A' };\nexport const One = {};\nexport const Two = {};\n",
    ...(build
      ? {
          'storybook-static/iframe.html': '<!doctype html>',
          'storybook-static/index.json': {
            v: 5,
            entries: Object.fromEntries(
              ids.map((id) => [
                id,
                {
                  type: 'story',
                  id,
                  title: 'C/A',
                  name: id.endsWith('one') ? 'One' : 'Two',
                  importPath: './src/A/A.stories.tsx',
                },
              ])
            ),
          },
        }
      : {}),
    '.pxsig/manifest.json': {
      version: 2,
      stories: ids.map((id) => ({
        id,
        story: id,
        sig: `.pxsig/baselines/A/${id}.psig`,
        importPath: 'src/A/A.stories.tsx',
      })),
    },
    '.pxsig/reports/check.json': {
      generatedAt: now,
      summary: {},
      rows: ids.map((id) => ({
        id,
        story: id,
        new: true,
        pass: false,
        metrics: null,
        reasons: ['new: no baseline yet'],
        checkedAt: now,
      })),
    },
    ...Object.fromEntries(ids.map((id) => [`.pxsig/renders/latest/${id}.png`, CHECKER])),
  });
  // The story file older than the renders: nothing is stale.
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(join(root, 'src/A/A.stories.tsx'), old, old);
  for (const id of ids) utimesSync(join(root, `.pxsig/renders/latest/${id}.png`), old, old);
  return root;
}

test('doctor after a first check served from staticDir reads the build, not a static scan', () => {
  const r = cli(['doctor', '--plain'], firstRun());
  assert.match(r.stdout, /index: Storybook build \(storybook-static\)/, r.stdout);
  assert.doesNotMatch(r.stdout + r.stderr, /static scan/);
  assert.doesNotMatch(r.stdout, /storybook-unreachable/);
  const json = JSON.parse(cli(['doctor', '--json'], firstRun()).stdout);
  assert.equal(json.sources.storyIndex.source, 'storybook');
  assert.equal(json.sources.storyIndex.build, 'storybook-static');
  assert.equal(json.sources.storyIndex.reachable, false);
  assert.deepEqual(json.summary.byCode, { unbaselined: 2 });
});

test('without a build, or --offline, doctor still says it used the static scan', () => {
  const none = cli(['doctor', '--plain'], firstRun({ build: false }));
  assert.match(none.stdout, /reconciled against a static scan of the story files/);
  const offline = cli(['doctor', '--plain', '--offline'], firstRun());
  assert.match(offline.stdout, /index: static scan/);
});

test('doctor --repair asks for no step when every entry is new: Next is reviewing them', () => {
  const r = cli(['doctor', '--plain'], firstRun());
  assert.match(r.stdout, /`pxsig serve` — review the new entries and approve their first renders/);
  assert.doesNotMatch(r.stdout, /pxsig doctor --repair/);
  // Anything else to repair: --repair is the next step again.
  const root = firstRun();
  rmSync(join(root, '.pxsig/renders/latest', `${ids[0]}.png`));
  const other = cli(['doctor', '--plain'], root);
  assert.match(other.stdout, /pxsig doctor --repair/);
});

test('doctor has no Settings row (nothing writes settings.json in this version)', () => {
  const r = cli(['doctor', '--plain'], firstRun());
  assert.doesNotMatch(r.stdout, /\*\*Settings:\*\*|not used in this version/);
  assert.match(r.stdout, /Approval guard files/);
});

test('the verdict agrees with the exit: no "No errors" above an exit 1', () => {
  const r = cli(['doctor', '--plain'], firstRun());
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /No errors/);
  assert.match(r.stdout, /2 findings at or above --fail-on warn, 0 errors/);
  const ci = cli(['doctor', '--plain', '--ci'], firstRun());
  assert.equal(ci.status, 0, ci.stdout + ci.stderr);
  assert.match(ci.stdout, /No errors; 1 component with warnings/);
});
