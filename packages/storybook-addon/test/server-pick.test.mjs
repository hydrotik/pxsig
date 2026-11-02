// Which pxsig server the panel uses: only one that serves this Storybook's workspace. The preset
// computes the same workspace id as pxsig, so a server's status answer can be matched to it.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { acceptsServer, DEFAULT_SERVER } from '../server-pick.mjs';
import { serverFile, serverUrlFor, workspaceId } from '../../pxsig/src/lib/workspace/peers.mjs';

const { managerHead, workspaceIdOf } = createRequire(import.meta.url)('../preset.cjs');
const ws = mkdtempSync(join(tmpdir(), 'pxsig-pick-'));
after(() => rmSync(ws, { recursive: true, force: true }));
writeFileSync(join(ws, 'pxsig.workspace.json'), '{"version":1,"projects":{}}');
mkdirSync(join(ws, '.storybook'));

test("the preset's workspace id is pxsig's, and carries no path", () => {
  const id = workspaceIdOf({ configDir: join(ws, '.storybook') });
  assert.equal(id, workspaceId(ws));
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(workspaceIdOf({}), null);
});

test('a server that names this workspace is used; one that names another is passed over', () => {
  const at = { workspaceId: 'aaaaaaaaaaaaaaaa', pinned: ['http://127.0.0.1:6471'] };
  for (const url of [DEFAULT_SERVER, 'http://127.0.0.1:6471']) {
    assert.equal(acceptsServer({ workspaceId: 'aaaaaaaaaaaaaaaa' }, { ...at, url }), true);
    assert.equal(acceptsServer({ workspaceId: 'bbbbbbbbbbbbbbbb' }, { ...at, url }), false);
  }
});

test('a server that names no workspace (pxsig 0.6): only at an address found for this workspace', () => {
  const at = { workspaceId: 'aaaaaaaaaaaaaaaa', pinned: ['http://127.0.0.1:6471'] };
  assert.equal(acceptsServer({}, { ...at, url: 'http://127.0.0.1:6471' }), true);
  assert.equal(acceptsServer({}, { ...at, url: DEFAULT_SERVER }), false);
  assert.equal(
    acceptsServer({}, { ...at, pinned: [DEFAULT_SERVER], url: DEFAULT_SERVER }),
    true,
    'the workspace’s own server.json names the default port'
  );
});

test('the pxsig-server localStorage key is always used', () => {
  const url = 'http://127.0.0.1:7000';
  const at = { url, workspaceId: 'aaaaaaaaaaaaaaaa', override: url };
  assert.equal(acceptsServer({ workspaceId: 'bbbbbbbbbbbbbbbb' }, at), true);
  assert.equal(acceptsServer({}, at), true);
});

test("the preset reads server.json where pxsig writes it, and the default is pxsig's", () => {
  const configDir = join(ws, '.storybook');
  /** @returns {string[]} the servers the preset hands the manager */
  const servers = () =>
    JSON.parse(
      /** @type {string} */ (/__PXSIG__=(.*)<\/script>/.exec(managerHead('', { configDir }))?.[1])
    ).servers;
  // No server file: pxsig falls back to the default port, the address the manager also tries.
  assert.equal(serverUrlFor(ws, { env: {} }), DEFAULT_SERVER);
  assert.deepEqual(servers(), []);
  // The file `pxsig serve` writes for this workspace (peers.mjs serverFile): both read the same one.
  mkdirSync(join(serverFile(ws), '..'), { recursive: true });
  writeFileSync(serverFile(ws), JSON.stringify({ url: 'http://127.0.0.1:6471' }));
  assert.equal(serverUrlFor(ws, { env: {} }), 'http://127.0.0.1:6471');
  assert.deepEqual(servers(), ['http://127.0.0.1:6471']);
  rmSync(join(ws, 'node_modules'), { recursive: true, force: true });
});
