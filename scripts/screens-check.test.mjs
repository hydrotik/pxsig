// screens-check.mjs: each dashboard screen in each theme is one entry, with an id the server takes.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { screenEntries, screenId } from './screens-check.mjs';

test('a screen id is <section>--<feature>-<n>@<theme>', () => {
  assert.deepEqual(screenId('inspector.header', 1, 'dark'), {
    id: 'inspector--header-1@dark',
    story: 'inspector--header-1',
  });
  assert.equal(screenId('shell.top-bar', 7, 'light').id, 'shell--top-bar-7@light');
  assert.equal(screenId('a11y.rules.more', 2, 'dark').id, 'a11y--rules-more-2@dark');
  assert.throws(() => screenId('Shell.Top', 1, 'dark'), /no valid entry id/);
});

test('entries: both themes per screen, the baseline by section, the defining file', () => {
  const catalogue = /** @type {import('../packages/pxsig/src/types/t4.js').ScreenCatalogue} */ (
    /** @type {unknown} */ ({
      features: [{ id: 'overview.counts', screens: [{}, {}] }],
    })
  );
  const e = screenEntries(
    catalogue,
    (id, section) => `.pxsig/baselines/${section}/${id}.psig`,
    () => 'src/ui/features/overview.ts'
  );
  assert.deepEqual(
    e.map((x) => x.id),
    [
      'overview--counts-1@dark',
      'overview--counts-1@light',
      'overview--counts-2@dark',
      'overview--counts-2@light',
    ]
  );
  assert.equal(e[1].sig, '.pxsig/baselines/overview/overview--counts-1@light.psig');
  assert.equal(e[1].mode, 'light');
  assert.equal(e[1].colorScheme, 'light');
  assert.equal(e[1].importPath, 'src/ui/features/overview.ts');
  assert.deepEqual(e[1].viewport, [1280, 900]);
});

test('two screens that would share an id are an error, not an overwrite', () => {
  const catalogue = /** @type {import('../packages/pxsig/src/types/t4.js').ScreenCatalogue} */ (
    /** @type {unknown} */ ({
      features: [
        { id: 'shell.top-bar', screens: [{}] },
        { id: 'shell.top.bar', screens: [{}] },
      ],
    })
  );
  assert.throws(
    () =>
      screenEntries(
        catalogue,
        () => 'x.psig',
        () => 'f.ts'
      ),
    /shell\.top\.bar #1 and shell\.top-bar #1 make the same entry id shell--top-bar-1@dark/
  );
});
