/**
 * setup-adapter.test.mjs — the instruction `pxsig setup` gives the assistant mentions building the
 * dashboard on a design system only when a project's config names a UI adapter (`dashboard.ui`).
 *
 *   node --test packages/pxsig/test/setup-adapter.test.mjs
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ADAPTER_SNIPPET, SNIPPET } from '../src/lib/assistants.mjs';
import { namesAdapter, setupCommand } from '../src/setup.mjs';
import { tempDir } from './fixture.mjs';

/**
 * The instruction text `setup --assistant claude-code --print` gives for a repository at `root`.
 * @param {string} root
 */
async function instruction(root) {
  const r = await setupCommand({ root, flags: { assistant: 'claude-code', print: true } });
  const f = r.data.files?.find((x) => x.role === 'instructions');
  assert.ok(f, 'claude-code has an instruction file');
  return f.text;
}

test('no dashboard.ui: the instruction is the approval rule alone', async (t) => {
  const root = tempDir('setup-plain', t);
  writeFileSync(join(root, 'pxsig.config.json'), JSON.stringify({ name: 'a' }));
  assert.equal(namesAdapter(root), false);
  assert.equal(await instruction(root), SNIPPET);
  assert.ok(!SNIPPET.includes('design system'));
});

test('dashboard.ui set: the build-adapter line is added', async (t) => {
  const root = tempDir('setup-ui', t);
  writeFileSync(
    join(root, 'pxsig.config.json'),
    JSON.stringify({ name: 'a', dashboard: { ui: './my-ui' } })
  );
  assert.equal(namesAdapter(root), true);
  assert.equal(await instruction(root), SNIPPET + ADAPTER_SNIPPET);
});

test('no workspace at all: no adapter', (t) => {
  assert.equal(namesAdapter(tempDir('setup-none', t)), false);
});
