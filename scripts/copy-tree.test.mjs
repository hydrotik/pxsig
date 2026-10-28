// copy-tree.mjs: a file or a folder, filtered, merged into an existing destination, on a path with
// a space and an é (the case Node's cpSync gets wrong on Windows).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { copyTree } from './lib/copy-tree.mjs';

const root = mkdtempSync(join(tmpdir(), 'copy tree é-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** A small tree: a.txt, sub/b.txt, node_modules/x.txt. */
function source() {
  const d = mkdtempSync(join(root, 'src é-'));
  writeFileSync(join(d, 'a.txt'), 'a');
  mkdirSync(join(d, 'sub'));
  writeFileSync(join(d, 'sub', 'b.txt'), 'b');
  mkdirSync(join(d, 'node_modules'));
  writeFileSync(join(d, 'node_modules', 'x.txt'), 'x');
  return d;
}

test('copies a folder, every level, to a new destination', () => {
  const to = join(root, 'out é 1');
  copyTree(source(), to);
  assert.equal(readFileSync(join(to, 'a.txt'), 'utf8'), 'a');
  assert.equal(readFileSync(join(to, 'sub', 'b.txt'), 'utf8'), 'b');
  assert.equal(readFileSync(join(to, 'node_modules', 'x.txt'), 'utf8'), 'x');
});

test('a refused folder is skipped with everything in it', () => {
  const to = join(root, 'out é 2');
  copyTree(source(), to, { filter: (p) => !p.includes('node_modules') });
  assert.ok(existsSync(join(to, 'sub', 'b.txt')));
  assert.ok(!existsSync(join(to, 'node_modules')));
});

test('a refused top path copies nothing', () => {
  const to = join(root, 'out é 3');
  copyTree(source(), to, { filter: () => false });
  assert.ok(!existsSync(to));
});

test('a file copies to its path, creating the folders; an existing file is overwritten', () => {
  const from = join(source(), 'a.txt');
  const to = join(root, 'out é 4', 'deep', 'a.txt');
  copyTree(from, to);
  assert.equal(readFileSync(to, 'utf8'), 'a');
  writeFileSync(from, 'a2');
  copyTree(from, to);
  assert.equal(readFileSync(to, 'utf8'), 'a2');
});

test('an existing destination folder is merged into', () => {
  const to = join(root, 'out é 5');
  mkdirSync(to);
  writeFileSync(join(to, 'kept.txt'), 'k');
  copyTree(source(), to);
  assert.equal(readFileSync(join(to, 'kept.txt'), 'utf8'), 'k');
  assert.equal(readFileSync(join(to, 'a.txt'), 'utf8'), 'a');
});
