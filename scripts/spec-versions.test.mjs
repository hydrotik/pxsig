// docs/spec.md section 8, "Versioning": each format's version and the closed lists (exit codes,
// verdict states), pinned to the code and to the spec's own sections. A change to any of them
// changes this file in the same commit, where a reviewer sees it (docs/quality/RUBRIC.md, §1).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/** @param {string} rel */
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const spec = read('docs/spec.md');

const PINNED = {
  record: 1,
  container: 1,
  manifest: 2,
  exitCodes: ['0', '1', '2', '3'],
  verdicts: [
    'pass',
    'drift',
    'changed',
    'flaky',
    'new',
    'error',
    'approved',
    'rejected',
    'skipped',
  ],
};

/**
 * The text of a spec section, from its heading to the next heading of the same or a higher level.
 * @param {string} heading the whole heading line, `### Exit codes`
 */
function section(heading) {
  const start = spec.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `docs/spec.md has "${heading}"`);
  const level = heading.split(' ')[0];
  const rest = spec.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`^#{1,${level.length}} `, 'm'));
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * The first cell of each body row of the first table in `text`, backticks removed.
 * @param {string} text
 */
const firstColumn = (text) =>
  text
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .slice(2)
    .map((l) => l.split('|')[1].trim().replaceAll('`', ''));

/** A row of the Versioning table: its last cell. @param {string} format */
function versionCell(format) {
  const row = section('## 8. Versioning')
    .split('\n')
    .find((l) => l.replaceAll('`', '').startsWith(`| ${format} `));
  assert.ok(row, `the Versioning table has a "${format}" row`);
  return row.split('|').at(-2)?.trim().replaceAll('`', '') ?? '';
}

test('the record and container versions: the Rust constants and the spec agree', () => {
  const rust = (/** @type {string} */ file, /** @type {string} */ name) =>
    Number(new RegExp(`pub const ${name}: \\w+ = (\\d+);`).exec(read(file))?.[1]);
  assert.equal(rust('crates/pxsig-core/src/record.rs', 'SPEC_VERSION'), PINNED.record);
  assert.equal(rust('crates/pxsig-core/src/psig.rs', 'CONTAINER_VERSION'), PINNED.container);
  assert.equal(versionCell('Signature record (spec v1)'), String(PINNED.record));
  assert.equal(versionCell('.psig container'), String(PINNED.container));
  assert.match(
    spec,
    new RegExp(`^## 5\\. The \`\\.psig\` container, version ${PINNED.container}$`, 'm')
  );
  assert.match(spec, new RegExp(`"version": ${PINNED.record},`));
});

test('the manifest version: the writers, the type and the spec agree', () => {
  assert.equal(versionCell('Manifest'), String(PINNED.manifest));
  assert.match(spec, new RegExp(`^## 6\\. Manifest, version ${PINNED.manifest}$`, 'm'));
  assert.match(
    read('packages/pxsig/src/types/store.d.ts'),
    new RegExp(`version: ${PINNED.manifest};`)
  );
  for (const f of [
    'packages/pxsig/src/lib/setup.mjs',
    'packages/pxsig/src/lib/workspace/run-manifest.mjs',
  ])
    assert.match(read(f), new RegExp(`version: ${PINNED.manifest},`), f);
});

test('exit codes and verdict states: closed lists, the same in their sections and the table', () => {
  assert.deepEqual(firstColumn(section('### Exit codes')), PINNED.exitCodes);
  assert.equal(versionCell('Exit codes'), PINNED.exitCodes.join(', '));
  const verdicts = firstColumn(section('### Verdicts')).flatMap((c) => c.split(/,\s*/));
  assert.deepEqual(verdicts, PINNED.verdicts);
  assert.equal(versionCell('Verdict states'), PINNED.verdicts.join(', '));
});
