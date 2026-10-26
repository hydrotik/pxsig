// The component catalog copied from hydrotik (docs/ui/catalog/): it passes its schema, the package
// exports it, it agrees with the reference adapter, and the sync script refuses what it should.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../../scripts/json-schema.mjs';
import { syncCatalog, withoutContext } from '../../../scripts/sync-catalog.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const dir = join(repo, 'docs', 'ui', 'catalog');
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const ADAPTER = 'packages/dashboard/src/ui/adapters/hydrotik/index.tsx';
/** Exports of the design system's root entry that are not components. */
const NON_COMPONENTS = new Set(['Icons', 'BrandIcons']);

test('the copy passes its schema, carries no context paths, and names the commit it came from', () => {
  const text = readFileSync(join(dir, 'hydrotik.catalog.json'), 'utf8');
  assert.equal(withoutContext(text), text, 'already without context, in the generator format');
  assert.deepEqual(validate(read('hydrotik.catalog.schema.json'), read('hydrotik.catalog.json')), []);
  const source = read('hydrotik.catalog.source.json');
  assert.equal(source.repo, 'hydrotik/hydrotik');
  assert.match(source.commit, /^[0-9a-f]{40}$/);
});

test('the installed package exports the catalog as pxsig/ui/catalog/hydrotik.json', () => {
  // Lay the package out as npm installs it: prepack copies docs/ui into the package's docs/ui.
  const root = mkdtempSync(join(tmpdir(), 'pxsig-catalog-'));
  try {
    const pkg = join(root, 'node_modules', 'pxsig');
    mkdirSync(pkg, { recursive: true });
    cpSync(join(repo, 'packages', 'pxsig', 'package.json'), join(pkg, 'package.json'));
    cpSync(join(repo, 'docs', 'ui'), join(pkg, 'docs', 'ui'), { recursive: true });
    const require = createRequire(join(root, 'index.js'));
    const catalog = require('pxsig/ui/catalog/hydrotik.json');
    assert.ok(catalog.components.length > 100);
    assert.equal(require('pxsig/ui/catalog/hydrotik.schema.json').title, 'Component catalog');
    assert.equal(require('pxsig/ui/catalog/hydrotik.source.json').repo, 'hydrotik/hydrotik');
    const files = JSON.parse(readFileSync(join(repo, 'packages', 'pxsig', 'package.json'), 'utf8')).files;
    assert.ok(files.includes('docs'), 'docs/ is in the published files');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Every design-system export the adapter uses: `<ns>.<Name>` of a namespace import, and named imports. */
function adapterNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]@hydrotik\/design-system['"]/g)) {
    for (const u of source.matchAll(new RegExp(`\\b${m[1]}\\.([A-Z]\\w*)`, 'g'))) names.add(u[1]);
  }
  for (const m of source.matchAll(/import\s+\{([^}]*)\}\s+from\s+['"]@hydrotik\/design-system(?:\/[\w./-]+)?['"]/g)) {
    for (const spec of m[1].split(',')) {
      const s = spec.trim();
      if (!s || s.startsWith('type ')) continue;
      const name = s.split(/\s+as\s+/)[0].trim();
      if (/^[A-Z]\w*$/.test(name)) names.add(name);
    }
  }
  return [...names].filter((n) => !NON_COMPONENTS.has(n)).sort();
}

test("the catalog's pxsigParts are what the reference adapter imports", () => {
  const used = adapterNames(readFileSync(join(repo, ADAPTER), 'utf8'));
  const families = read('hydrotik.catalog.json').components.filter((c) => c.usedBy?.includes('pxsig'));
  const listed = families.flatMap((c) => c.pxsigParts).sort();
  const missing = used.filter((n) => !listed.includes(n));
  const extra = listed.filter((n) => !used.includes(n));
  assert.ok(
    !missing.length && !extra.length,
    [
      `${ADAPTER} and docs/ui/catalog/hydrotik.catalog.json disagree.`,
      missing.length ? `Used by the adapter, not in the catalog: ${missing.join(', ')}.` : '',
      extra.length ? `In the catalog, not used by the adapter: ${extra.join(', ')}.` : '',
      'In hydrotik run `hy-ai catalog --pxsig-adapter <pxsig>/' + ADAPTER + '` and merge it, then here run',
      '`node scripts/sync-catalog.mjs --from <hydrotik checkout>`.',
    ]
      .filter(Boolean)
      .join('\n')
  );
  assert.ok(families.every((c) => c.pxsigParts.length), 'every usedBy family names its parts');
});

test('the adapter scan reads namespace members and named imports, not types or icons', () => {
  const src = [
    "import '@hydrotik/design-system/fonts';",
    "import * as DS from '@hydrotik/design-system';",
    "import { ChartLegend, type ChartConfig, ChartTooltip as Tip } from '@hydrotik/design-system/chart';",
    'const a = <DS.Card><DS.CardTitle /><DS.Icons.X /></DS.Card>;',
  ].join('\n');
  assert.deepEqual(adapterNames(src), ['Card', 'CardTitle', 'ChartLegend', 'ChartTooltip']);
});

test('the schema check reports what it finds, and rejects keywords it does not know', () => {
  const schema = {
    type: 'object',
    required: ['a'],
    additionalProperties: false,
    properties: {
      a: { enum: ['x', 'y'] },
      b: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: '^[a-z]+$', maxLength: 3 } },
      c: { type: 'object', if: { properties: { s: { const: 'archived' } } }, then: { required: ['why'] }, else: { not: { required: ['why'] } } },
    },
  };
  assert.deepEqual(validate(schema, { a: 'x', b: ['ab'], c: { s: 'active' } }), []);
  const errs = validate(schema, { b: ['AB', 'AB', 'abcd'], c: { s: 'archived' }, d: 1 }).join('\n');
  for (const m of [/required property 'a'/, /unique items/, /must match/, /longer than 3/, /required property 'why'/, /\/d is not allowed/]) assert.match(errs, m);
  assert.match(validate(schema.properties.c, { s: 'active', why: 'x' }).join(), /must not match/);
  assert.match(validate({ $ref: '#/x' }, {}).join(), /keyword "\$ref" is not supported/);
  assert.match(validate({ type: ['string', 'null'] }, 3).join(), /must be string or null/);
});

test('sync-catalog refuses an unknown, dirty or unpushed checkout, and copies a good one', () => {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-sync-'));
  const src = join(root, 'hydrotik');
  const out = join(root, 'out');
  const git = (...args) => execFileSync('git', ['-C', src, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
  try {
    mkdirSync(join(src, 'docs', 'llm'), { recursive: true });
    // A source record carries its context path, as hydrotik's do; the copy drops it.
    const withContext = read('hydrotik.catalog.json');
    withContext.components[0].context = 'docs/x.llm-context.md';
    writeFileSync(join(src, 'docs/llm/catalog.json'), `${JSON.stringify(withContext, null, 2)}\n`);
    cpSync(join(dir, 'hydrotik.catalog.schema.json'), join(src, 'docs/llm/catalog.schema.json'));
    assert.match(syncCatalog(src, out).message, /not a git checkout/);
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'catalog');
    git('remote', 'add', 'origin', 'git@github.com:someone/else.git');
    assert.match(syncCatalog(src, out).message, /not hydrotik\/hydrotik/);
    git('remote', 'set-url', 'origin', 'https://github.com/hydrotik/hydrotik.git');
    assert.match(syncCatalog(src, out).message, /on no remote branch/);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    writeFileSync(join(src, 'docs/llm/catalog.json'), '{}');
    assert.match(syncCatalog(src, out).message, /uncommitted changes under docs\/llm/);
    git('commit', '-qam', 'broken');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    assert.match(syncCatalog(src, out).message, /does not pass its schema/);
    git('reset', '-q', '--hard', 'HEAD~1');
    const r = syncCatalog(src, out);
    assert.ok(r.ok, r.message);
    assert.equal(readFileSync(join(out, 'hydrotik.catalog.json'), 'utf8'), readFileSync(join(dir, 'hydrotik.catalog.json'), 'utf8'));
    assert.ok(!readFileSync(join(out, 'hydrotik.catalog.json'), 'utf8').includes('"context"'), 'context paths are dropped');
    assert.equal(JSON.parse(readFileSync(join(out, 'hydrotik.catalog.source.json'), 'utf8')).commit, git('rev-parse', 'HEAD').trim());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
