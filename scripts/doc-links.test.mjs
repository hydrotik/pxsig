import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leftLinks, versionLinks } from './lib/doc-links.mjs';

const script = fileURLToPath(new URL('./pack-manifest.mjs', import.meta.url));
const U = 'https://github.com/hydrotik/pxsig';

test('links to main and out of the package are pinned to the tag; the rest are left alone', () => {
  const md = [
    `[cli](${U}/blob/main/docs/cli.md) [tree](${U}/tree/main/examples)`,
    '[server](../../docs/server.md#routes) [ui](src/ui/README.md) [top](#usage)',
    '[npm](https://www.npmjs.com/package/pxsig) [abs](/docs/x.md) [far](../../../elsewhere.md)',
    '[titled](../../docs/a.md "A")',
  ].join('\n');
  const held = (/** @type {string} */ p) => p === 'src/ui/README.md';
  const out = versionLinks(md, { version: '0.7.0', source: 'packages/dashboard/README.md', held });
  assert.equal(
    out,
    [
      `[cli](${U}/blob/v0.7.0/docs/cli.md) [tree](${U}/tree/v0.7.0/examples)`,
      `[server](${U}/blob/v0.7.0/docs/server.md#routes) [ui](src/ui/README.md) [top](#usage)`,
      '[npm](https://www.npmjs.com/package/pxsig) [abs](/docs/x.md) [far](../../../elsewhere.md)',
      '[titled](../../docs/a.md "A")',
    ].join('\n')
  );
  assert.deepEqual(leftLinks(md, held), [
    `${U}/blob/main/`,
    `${U}/tree/main/`,
    '../../docs/server.md#routes',
    '../../../elsewhere.md',
  ]);
  assert.deepEqual(leftLinks(out, held), ['../../../elsewhere.md']);
});

test(
  'pack-manifest pins a README by its repository.directory; --check fails one that links to main',
  {
    skip:
      spawnSync('npm', ['--version'], { shell: process.platform === 'win32' }).status !== 0 &&
      'npm is not on PATH',
  },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'pxsig-doc-links-'));
    /** @param {string} cwd @param {string} to */
    const pack = (cwd, to) =>
      spawnSync('npm', ['pack', '--ignore-scripts', '--pack-destination', to], {
        cwd,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
    try {
      const pkg = join(dir, 'pkg');
      for (const d of [pkg, join(dir, 'a'), join(dir, 'b')]) mkdirSync(d, { recursive: true });
      writeFileSync(
        join(pkg, 'package.json'),
        JSON.stringify({
          name: 'doc-links-fixture',
          version: '1.2.3',
          repository: { type: 'git', url: `git+${U}.git`, directory: 'packages/fixture' },
        })
      );
      const readme = `[cli](${U}/blob/main/docs/cli.md) [guide](../../docs/guide.md)\n`;
      writeFileSync(join(pkg, 'README.md'), readme);
      writeFileSync(join(pkg, 'LICENSE'), 'MIT\n');
      assert.equal(pack(pkg, join(dir, 'a')).status, 0);
      const before = spawnSync(
        process.execPath,
        [script, '--check', join(dir, 'a', readdirSync(join(dir, 'a'))[0])],
        { encoding: 'utf8' }
      );
      assert.equal(before.status, 1);
      assert.match(
        before.stderr,
        /README\.md: https:\/\/github\.com\/hydrotik\/pxsig\/blob\/main\//
      );
      assert.match(before.stderr, /README\.md: \.\.\/\.\.\/docs\/guide\.md/);
      assert.equal(spawnSync(process.execPath, [script, pkg]).status, 0);
      assert.equal(
        readFileSync(join(pkg, 'README.md'), 'utf8'),
        `[cli](${U}/blob/v1.2.3/docs/cli.md) [guide](${U}/blob/v1.2.3/docs/guide.md)\n`
      );
      assert.equal(pack(pkg, join(dir, 'b')).status, 0);
      const after = spawnSync(
        process.execPath,
        [script, '--check', join(dir, 'b', readdirSync(join(dir, 'b'))[0])],
        { encoding: 'utf8' }
      );
      assert.equal(after.status, 0, after.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);
