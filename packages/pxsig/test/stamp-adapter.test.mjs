/**
 * The adapter in a `pxsig dashboard build` stamp (lib/stamp-adapter.mjs): a built-in one by its
 * name, any other relative to the project root, never an absolute path; and `dashboard check`
 * reading it back, an older stamp's absolute path included.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { test } from 'node:test';
import { stampAdapter, stampedAdapter } from '../src/lib/stamp-adapter.mjs';
import { tempDir } from './fixture.mjs';

test('stampAdapter: a built-in adapter by name; a project adapter relative to the project root', () => {
  const root = tempDir('proj');
  const builtins = join(tempDir('pkg'), 'src', 'ui', 'adapters');
  assert.equal(
    stampAdapter({ name: 'plain', file: join(builtins, 'plain', 'index.tsx') }, root, builtins),
    'plain'
  );
  const own = stampAdapter(
    { name: 'pxsig-ui', file: join(root, 'pxsig-ui', 'index.tsx') },
    root,
    builtins
  );
  assert.equal(own, './pxsig-ui/index.tsx');
  const up = stampAdapter(
    { name: 'ui', file: join(root, '..', 'shared', 'ui', 'index.tsx') },
    join(root, 'app'),
    builtins
  );
  assert.match(up, /^\.\.\/\.\.\/shared\/ui\/index\.tsx$/);
  for (const v of [own, up]) assert.equal(isAbsolute(v), false, v);
});

test('stampedAdapter: what dashboard check passes as --ui: a name, a path that exists, or nothing', () => {
  const root = tempDir('proj');
  mkdirSync(join(root, 'pxsig-ui'));
  writeFileSync(join(root, 'pxsig-ui', 'index.tsx'), '');
  assert.equal(stampedAdapter('hydrotik', root), 'hydrotik');
  assert.equal(stampedAdapter('./pxsig-ui/index.tsx', root), './pxsig-ui/index.tsx');
  const old = join(root, 'pxsig-ui', 'index.tsx');
  assert.equal(stampedAdapter(old, tempDir('elsewhere')), old, "an older stamp's absolute path");
  assert.equal(stampedAdapter('./gone/index.tsx', root), undefined);
  assert.equal(stampedAdapter(undefined, root), undefined);
});
