/**
 * What the coverage block counts and when it shows (src/views/coverage-findings.ts), and a title in
 * en.json for every code the ledger can name: each entry code (lib/integrity/codes.mjs) and each
 * setup code any of pxsig's sources can put in the ledger's `setup`.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CODES } from '../../pxsig/src/lib/integrity/codes.mjs';
import {
  concernsComponents,
  coverageFindings,
  coverageShown,
  errorCodes,
  repairEntries,
} from '../src/views/coverage-findings.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.join(here, '../../pxsig/src/lib');
const en = JSON.parse(readFileSync(path.join(here, '../src/copy/en.json'), 'utf8'));

const issue = (code, severity) => ({ code, severity, reason: 'sample' });
const ledger = (entries, setup = []) => {
  const byCode = {};
  for (const x of entries) for (const i of x.issues) byCode[i.code] = (byCode[i.code] ?? 0) + 1;
  return {
    entries: entries.map((issues, i) => ({ id: `e${i}`, component: 'C', ...issues })),
    setup,
    summary: { byCode },
  };
};
const e = (...issues) => ({ issues });
const noPlan = { entries: 0, steps: [] };

test('counts by severity: entries at their worst finding, setup findings; review work and info never', () => {
  const L = ledger(
    [
      e(issue('changed', 'warn')),
      e(issue('changed', 'error')), // raised by integrity.severity: still review work
      e(issue('unbaselined', 'warn')),
      e(issue('a11y-new', 'warn')),
      e(issue('drift', 'info')),
      e(issue('never-checked', 'error'), issue('stale', 'warn')),
      e(issue('render-error', 'error')),
      e(issue('stale', 'warn')),
      e(issue('missing-render', 'warn'), issue('stale', 'warn')),
    ],
    [
      issue('store-conflict', 'error'),
      issue('env-mismatch', 'warn'),
      issue('log-legacy-personal', 'info'),
    ]
  );
  const f = coverageFindings(L);
  assert.deepEqual(f.entries, { error: 2, warn: 2 });
  assert.deepEqual(f.setup, { error: 1, warn: 1 });
  assert.equal(f.error, 3);
  assert.equal(f.warn, 3);
  assert.deepEqual(errorCodes(L), [
    ['never-checked', 1],
    ['render-error', 1],
  ]);
});

test('info findings alone, or changed entries alone, never show the block', () => {
  const info = ledger([e(issue('drift', 'info'))], [issue('log-legacy-personal', 'info')]);
  assert.equal(coverageShown({ integrity: info, repair: noPlan }), false);
  const changed = ledger(
    [e(issue('changed', 'warn')), e(issue('changed', 'error'))],
    [issue('storybook-unreachable', 'info')]
  );
  assert.equal(coverageShown({ integrity: changed, repair: noPlan }), false);
  // Entry warnings with nothing to run stay on Coverage.
  const stale = ledger([e(issue('stale', 'warn'))]);
  assert.equal(coverageShown({ integrity: stale, repair: noPlan }), false);
  assert.equal(coverageShown({ integrity: null, repair: noPlan }), false);
});

test('errors and setup warnings show the block; so does a plan with steps', () => {
  const err = ledger([e(issue('never-checked', 'error'))]);
  assert.equal(coverageShown({ integrity: err, repair: noPlan }), true);
  const setupErr = ledger([], [issue('store-conflict', 'error')]);
  assert.equal(coverageShown({ integrity: setupErr, repair: noPlan }), true);
  const setupWarn = ledger([], [issue('env-mismatch', 'warn')]);
  assert.equal(coverageShown({ integrity: setupWarn, repair: noPlan }), true);
  const missing = ledger([e(issue('missing-render', 'warn'))]);
  const plan = { entries: 1, steps: [{ action: 'recheck', count: 1 }] };
  assert.equal(coverageShown({ integrity: missing, repair: noPlan }), false);
  assert.equal(coverageShown({ integrity: missing, repair: plan }), true);
});

test('the repair button: no steps, no entries (no button); steps, their entry count', () => {
  assert.equal(repairEntries({ repair: noPlan }), 0);
  assert.equal(repairEntries({ repair: null }), 0);
  assert.equal(repairEntries({}), 0);
  // A summary with entries but no step is nothing to run.
  assert.equal(repairEntries({ repair: { entries: 3, steps: [] } }), 0);
  assert.equal(
    repairEntries({
      repair: {
        entries: 3,
        steps: [
          { action: 'register', count: 1 },
          { action: 'recheck', count: 3 },
        ],
      },
    }),
    3
  );
});

test('"View components": only for entries with findings or waiting for a first approval', () => {
  assert.equal(concernsComponents(ledger([], [issue('env-mismatch', 'warn')])), false);
  assert.equal(concernsComponents(ledger([e(issue('changed', 'warn'))])), false);
  assert.equal(concernsComponents(ledger([e(issue('stale', 'warn'))])), true);
  assert.equal(concernsComponents(ledger([e(issue('unbaselined', 'warn'))])), true);
});

/**
 * What the ledger's `setup` is made of (lib/integrity/reconcile.mjs): its own problems, the
 * workspace's, portability, drift and warn mode. A new source of setup findings is added here.
 */
const SETUP_SOURCES = ['integrity', 'workspace', 'enforcement', 'portability.mjs', 'drift.mjs'];

/** Every `.mjs` under a folder, recursively. */
const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? sources(path.join(dir, d.name))
      : d.name.endsWith('.mjs')
        ? [path.join(dir, d.name)]
        : []
  );

/**
 * The setup codes pxsig's sources write: `{ code: '…', severity` objects and the `add('…', …)`
 * helper of problems.mjs. A thrown error's code (`no-manifest`) has no severity beside it.
 */
function setupCodes() {
  const codes = new Set();
  for (const f of SETUP_SOURCES.flatMap((p) =>
    p.endsWith('.mjs') ? [path.join(lib, p)] : sources(path.join(lib, p))
  )) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/code: '([a-z0-9-]+)',\s*severity\b/g)) codes.add(m[1]);
    for (const m of src.matchAll(/\badd\(\s*'([a-z0-9-]+)',\s*'(?:error|warn|info)'/g))
      codes.add(m[1]);
  }
  for (const code of Object.keys(CODES)) codes.delete(code);
  return [...codes].sort((a, b) => a.localeCompare(b));
}

test('every code the ledger can name has a title and a help line in en.json', () => {
  const setup = setupCodes();
  // The scan finds them: these are known setup codes, so an empty or partial scan fails here.
  for (const known of ['env-mismatch', 'log-legacy-personal', 'store-conflict', 'line-endings'])
    assert.ok(setup.includes(known), `the scan finds ${known}`);
  const missing = [...Object.keys(CODES), ...setup].filter((code) => {
    const c = en.coverage.codes[code];
    return !(typeof c?.title === 'string' && c.title && typeof c.help === 'string' && c.help);
  });
  assert.deepEqual(missing, [], `codes without a title in en.json: ${missing.join(', ')}`);
});
