// The preset's build step: `storybook build` gets pxsig-snapshot.json from the workspace's own
// pxsig; `storybook dev`, `snapshot: false`, no pxsig or a failing one change nothing and never
// fail the build.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const { staticDirs } = createRequire(import.meta.url)('../preset.cjs');
const made = [];
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A workspace with a Storybook config dir and, unless `pxsig` is false, a stand-in pxsig CLI. */
function workspace({ pxsig = 'ok' } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'pxsig-preset-'));
  made.push(ws);
  writeFileSync(join(ws, 'pxsig.workspace.json'), '{"version":1,"projects":{}}');
  mkdirSync(join(ws, '.storybook'));
  if (pxsig) {
    const bin = join(ws, 'node_modules', 'pxsig', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'pxsig.mjs'),
      pxsig === 'ok'
        ? `import { mkdirSync, writeFileSync } from 'node:fs'; import { dirname } from 'node:path';
const out = process.argv[process.argv.indexOf('--out') + 1];
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ format: 'pxsig-snapshot', version: 1, argv: process.argv.slice(2) }));`
        : `process.stderr.write('pxsig: unknown command "snapshot"\\n'); process.exit(2);`
    );
  }
  return { ws, configDir: join(ws, '.storybook') };
}
const quiet = () => {
  const lines = [];
  return { lines, warn: (l) => lines.push(l) };
};

test('storybook build: the snapshot joins the static dirs at the root', async () => {
  const { ws, configDir } = workspace();
  const q = quiet();
  const dirs = await staticDirs(['public'], { configType: 'PRODUCTION', configDir }, q);
  assert.equal(dirs.length, 2);
  assert.equal(dirs[0], 'public');
  assert.equal(dirs[1].to, '/');
  const file = join(dirs[1].from, 'pxsig-snapshot.json');
  assert.ok(existsSync(file));
  const argv = JSON.parse(readFileSync(file, 'utf8')).argv;
  assert.deepEqual(argv.slice(0, 2), ['snapshot', '--out']);
  assert.ok(argv.includes('--workspace') && argv.includes(ws));
  assert.deepEqual(q.lines, []);
});

test('storybook dev and `snapshot: false`: nothing added, nothing run', async () => {
  const { configDir } = workspace();
  const q = quiet();
  assert.deepEqual(await staticDirs(['public'], { configType: 'DEVELOPMENT', configDir }, q), [
    'public',
  ]);
  assert.deepEqual(
    await staticDirs(['public'], { configType: 'PRODUCTION', configDir, snapshot: false }, q),
    ['public']
  );
  assert.deepEqual(q.lines, []);
});

test('no pxsig, or a pxsig without the command: one warning, the build goes on', async () => {
  for (const pxsig of [false, 'old']) {
    const { configDir } = workspace({ pxsig });
    const q = quiet();
    assert.deepEqual(await staticDirs([], { configType: 'PRODUCTION', configDir }, q), []);
    assert.equal(q.lines.length, 1);
    assert.match(q.lines[0], /^pxsig: no snapshot in this build \(/);
    if (pxsig === 'old') assert.match(q.lines[0], /unknown command "snapshot"/);
  }
});
