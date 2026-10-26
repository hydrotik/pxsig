/**
 * The UI contract's version (ui-tools.mjs, docs/ui/contract-changes.md): what counts as a major or a
 * minor change, what `pnpm ui:check` asks of a change, how an adapter's recorded version compares,
 * and the defaults that keep a new token additive.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareVersions, contractDiff, contractShape, contractStatus, lockFor, lockProblems, readChanges, readLock } from '../ui-tools.mjs';

const uiDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'src', 'ui');
const now = contractShape();
const lock = lockFor(now);
/** `now` changed by `edit` (a deep copy). */
const changed = (edit) => {
  const n = structuredClone(now);
  edit(n);
  return n;
};

test('the committed lock records the committed contract', () => {
  assert.deepEqual(contractDiff(readLock(), now), { major: [], minor: [] });
  assert.equal(readLock().version, now.version);
  assert.deepEqual(lockProblems({ lock: readLock(), now, changes: readChanges() }), []);
});

test('major and minor changes', () => {
  const d = (edit) => contractDiff(lock, changed(edit));
  assert.match(d((n) => delete n.components.Kbd).major[0], /Kbd was removed/);
  assert.match(d((n) => (n.components.Kbd.required = true)).major[0], /Kbd became required/);
  assert.match(d((n) => (n.components.Kbd.hash = 'x')).minor[0], /Kbd's props changed/);
  assert.match(d((n) => (n.components.Tabs = { required: false, hash: 'h' })).minor[0], /Tabs was added/);
  assert.match(d((n) => (n.components.Tabs = { required: true, hash: 'h' })).major[0], /Tabs was added as required/);
  assert.match(d((n) => n.tokens.push('color.info')).major[0], /token color\.info was added without a default/);
  assert.match(d((n) => (n.tokens.push('color.info'), n.tokenDefaults.push('color.info'))).minor[0], /with a default/);
  assert.match(d((n) => (n.icons = n.icons.filter((i) => i !== 'sun'))).major[0], /icon sun was removed/);
});

test('ui:check asks a change for a bump of the right size and a changes entry', () => {
  const changes = { '1.0.0': 'x', '1.1.0': 'y', '2.0.0': 'z' };
  const at = (version, edit = () => {}) => lockProblems({ lock, now: changed((n) => ((n.version = version), edit(n))), changes });
  assert.deepEqual(at('1.0.0'), []);
  assert.match(at('1.0.0', (n) => (n.components.Kbd.hash = 'x'))[0], /CONTRACT_VERSION is still 1\.0\.0: bump it \(minor\)/);
  assert.match(at('1.1.0', (n) => delete n.components.Kbd)[0], /a major change, but CONTRACT_VERSION went from 1\.0\.0 to 1\.1\.0/);
  assert.match(at('2.0.0', (n) => delete n.components.Kbd)[0], /run node scripts\/ui\.mjs lock to record 2\.0\.0/);
  assert.match(at('1.1.0')[0], /nothing changed/);
  assert.match(lockProblems({ lock, now: changed((n) => (n.version = '1.2.0')), changes })[0], /no "## 1\.2\.0" section/);
});

test("an adapter's recorded version against this pxsig's", () => {
  const l = { ...lockFor(now), version: '1.2.0', components: { ...lockFor(now).components, Tabs: { required: false, hash: 'h', since: '1.1.0' } }, tokens: { ...lockFor(now).tokens, 'color.info': '1.2.0' } };
  const changes = { '1.0.0': 'first', '1.1.0': 'Tabs', '1.2.0': 'color.info', '2.0.0': 'Move Badge to Tag.' };
  assert.equal(contractStatus('1.2.0', { lock: l, changes }).status, 'same');
  const minor = contractStatus('1.0.0', { lock: l, changes });
  assert.equal(minor.status, 'older-minor');
  assert.match(minor.line, /fall back to their defaults until the adapter maps them: Tabs, token color\.info/);
  assert.match(contractStatus('1.1.0', { lock: l, changes }).line, /token color\.info$/);
  assert.equal(contractStatus('1.3.0', { lock: l, changes }).status, 'newer');
  const major = contractStatus('1.2.0', { lock: { ...l, version: '2.0.0' }, changes });
  assert.equal(major.status, 'older-major');
  assert.deepEqual(major.notes, ['2.0.0:\nMove Badge to Tag.']);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
});

test('a token with a default is filled in when the adapter map lacks it', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pxsig-tokens-'));
  try {
    const src = readFileSync(path.join(uiDir, 'tokens.ts'), 'utf8').replace('export const TOKEN_DEFAULTS = {} as const', "export const TOKEN_DEFAULTS = { 'motion.fast': '120ms' } as const");
    writeFileSync(path.join(dir, 'tokens.ts'), src);
    const { TOKEN_NAMES, tokenCss } = await import(pathToFileURL(path.join(dir, 'tokens.ts')).href);
    const map = Object.fromEntries(TOKEN_NAMES.filter((n) => n !== 'motion.fast').map((n) => [n, 'x']));
    assert.match(tokenCss(map), /--pxsig-motion-fast:120ms;/);
    delete map['color.text'];
    assert.throws(() => tokenCss(map), /lacks: color\.text/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
