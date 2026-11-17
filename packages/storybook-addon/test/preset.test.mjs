// The preset's build step: `storybook build` gets pxsig-snapshot.json from the workspace's own
// pxsig; `storybook dev`, `snapshot: false`, no pxsig or a failing one change nothing and never
// fail the build.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { SNAPSHOT_PXSIG, staticDirs } from '../preset.mjs';

/** pxsig's own guarded start, which a stand-in pxsig's `pxsig/spawn` re-exports. */
const GUARDED = new URL('../../pxsig/src/public/spawn.mjs', import.meta.url).href;

/** @type {string[]} */
const made = [];
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

/**
 * A workspace with a Storybook config dir and, unless `pxsig` is false, a stand-in pxsig CLI.
 * `spawn`: its `pxsig/spawn` is pxsig's guarded start (`guarded`), the same with each start
 * recorded in starts.json (`record`), or absent, as in a pxsig before SNAPSHOT_PXSIG (`none`).
 * @param {{ pxsig?: string | false, spawn?: 'guarded' | 'record' | 'none' }} [opts]
 */
function workspace({ pxsig = 'ok', spawn = 'guarded' } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'pxsig-preset-'));
  made.push(ws);
  writeFileSync(join(ws, 'pxsig.workspace.json'), '{"version":1,"projects":{}}');
  mkdirSync(join(ws, '.storybook'));
  if (pxsig) {
    const pkg = join(ws, 'node_modules', 'pxsig');
    const bin = join(pkg, 'bin');
    mkdirSync(bin, { recursive: true });
    const exports = spawn === 'none' ? {} : { './spawn': './spawn.mjs' };
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: 'pxsig', version: '0.7.7', exports })
    );
    if (spawn !== 'none')
      writeFileSync(
        join(pkg, 'spawn.mjs'),
        spawn === 'guarded'
          ? `export { spawnSync } from ${JSON.stringify(GUARDED)};`
          : `import { writeFileSync } from 'node:fs'; import { spawnSync as guarded } from ${JSON.stringify(GUARDED)};
export function spawnSync(program, args, opts) {
  writeFileSync(${JSON.stringify(join(ws, 'starts.json'))}, JSON.stringify({ program, args, opts }));
  return guarded(program, args, opts);
}`
      );
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
  /** @type {string[]} */
  const lines = [];
  return { lines, warn: (/** @type {string} */ l) => lines.push(l) };
};

test('storybook build: the snapshot joins the static dirs at the root', async () => {
  const { ws, configDir } = workspace();
  const q = quiet();
  const dirs = await staticDirs(['public'], { configType: 'PRODUCTION', configDir }, q);
  assert.equal(dirs.length, 2);
  assert.equal(dirs[0], 'public');
  const added = dirs[1];
  assert.ok(typeof added === 'object', 'the snapshot folder is a { from, to } entry');
  assert.equal(added.to, '/');
  const file = join(added.from, 'pxsig-snapshot.json');
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
  for (const pxsig of /** @type {(string | false)[]} */ ([false, 'old'])) {
    const { configDir } = workspace({ pxsig });
    const q = quiet();
    assert.deepEqual(await staticDirs([], { configType: 'PRODUCTION', configDir }, q), []);
    assert.equal(q.lines.length, 1);
    assert.match(q.lines[0], /^pxsig: no snapshot in this build \(/);
    if (pxsig === 'old') assert.match(q.lines[0], /unknown command "snapshot"/);
  }
});

test('the one program the preset starts, through pxsig/spawn: node on the workspace CLI', async () => {
  const { ws, configDir } = workspace({ spawn: 'record' });
  const q = quiet();
  const dirs = await staticDirs([], { configType: 'PRODUCTION', configDir }, q);
  assert.equal(dirs.length, 1);
  const { program, args, opts } = JSON.parse(readFileSync(join(ws, 'starts.json'), 'utf8'));
  assert.equal(program, process.execPath);
  assert.equal(args[0], join(ws, 'node_modules', 'pxsig', 'bin', 'pxsig.mjs'));
  assert.deepEqual(args.slice(1, 3), ['snapshot', '--out']);
  assert.equal(opts.shell, undefined);
  assert.equal(opts.cwd, ws);
  assert.equal(opts.timeout, 120_000);
});

test('a pxsig without pxsig/spawn: no snapshot, one line naming the version it needs', async () => {
  const { ws, configDir } = workspace({ spawn: 'none' });
  const q = quiet();
  assert.deepEqual(await staticDirs([], { configType: 'PRODUCTION', configDir }, q), []);
  assert.deepEqual(q.lines, [
    `pxsig: no snapshot in this build (the snapshot needs pxsig ${SNAPSHOT_PXSIG} or later; this workspace has pxsig 0.7.7)`,
  ]);
  assert.ok(!existsSync(join(ws, 'node_modules', '.cache', 'pxsig', 'storybook')), 'nothing ran');
});
