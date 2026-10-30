/**
 * json-read.test.mjs — the one JSON reader (lib/files.mjs): a UTF-8 byte order mark (what Windows
 * Notepad writes) is skipped, a UTF-16 file is refused with its encoding named, and the workspace
 * reader turns each failure into a SetupError.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readJson, readJsonFile } from '../src/lib/files.mjs';
import { readJsonFile as readSetupJson, SetupError } from '../src/lib/workspace/core.mjs';
import { tempDir } from './fixture.mjs';

const VALUE = { version: 1, projects: { app: '.' } };
const TEXT = JSON.stringify(VALUE);

/**
 * @param {import('node:test').TestContext} t
 * @param {string | Buffer} body
 */
function file(t, body) {
  const p = join(tempDir('json-read', t), 'pxsig.workspace.json');
  writeFileSync(p, body);
  return p;
}

test('plain UTF-8 and UTF-8 with a BOM read the same value', (t) => {
  assert.deepEqual(readJsonFile(file(t, TEXT)), VALUE);
  const bom = file(t, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(TEXT)]));
  assert.deepEqual(readJsonFile(bom), VALUE);
  assert.deepEqual(readJson(bom, 'fallback'), VALUE);
  assert.deepEqual(readSetupJson(bom), VALUE);
});

test('a UTF-16 file is refused with its encoding named, with or without a BOM', (t) => {
  const le = Buffer.from(`﻿${TEXT}`, 'utf16le');
  const be = Buffer.from(le).swap16();
  const cases = /** @type {const} */ ([
    [le, 'LE'],
    [be, 'BE'],
    [Buffer.from(TEXT, 'utf16le'), 'LE'],
    [Buffer.from(Buffer.from(TEXT, 'utf16le')).swap16(), 'BE'],
  ]);
  for (const [body, order] of cases) {
    const p = file(t, body);
    assert.throws(() => readJsonFile(p), { message: `${p} is UTF-16 ${order}; save it as UTF-8` });
    assert.equal(readJson(p, 'fallback'), 'fallback');
    assert.throws(
      () => readSetupJson(p),
      (e) => e instanceof SetupError && e.message === `${p} is UTF-16 ${order}; save it as UTF-8`
    );
  }
});

test('a missing or broken file throws, or gives the fallback (null by default)', (t) => {
  const missing = join(tempDir('json-read', t), 'none.json');
  const broken = file(t, '{ "version": ');
  assert.throws(() => readJsonFile(missing), { code: 'ENOENT' });
  assert.throws(() => readJsonFile(broken), SyntaxError);
  assert.equal(readJson(missing), null);
  assert.deepEqual(readJson(broken, { rows: [] }), { rows: [] });
  assert.throws(
    () => readSetupJson(broken),
    (e) => e instanceof SetupError && e.message.startsWith(`${broken} is not valid JSON: `)
  );
});
