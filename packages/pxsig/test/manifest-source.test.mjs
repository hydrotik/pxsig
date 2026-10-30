// `pxsig manifest` names the story index it read (header and JSON) and warns, without changing the
// exit code, when srcRoot is missing or no story is under the project. Every Storybook here is a
// stand-in on a port this file starts, or a static build pxsig serves itself.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { manifestWarnings } from '../src/lib/setup.mjs';
import { fakeStorybook } from './server-helpers.mjs';
import { src, tree } from './features-helpers.mjs';
import { rustBin, testEnv, testHome } from './fixture.mjs';
/** @import { Project } from '../src/types.js' */

let chromium = false;
try {
  const pw = await import('playwright');
  await (await pw.chromium.launch()).close();
  chromium = true;
} catch {
  // no browser: the end-to-end tests skip
}

/**
 * The CLI, without blocking this process: the stand-in Storybook answers from it.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string }>}
 */
const run = (args, cwd) =>
  new Promise((ok) => {
    const p = spawn(process.execPath, [join(src, 'cli.mjs'), ...args], {
      cwd,
      env: {
        ...testEnv(testHome),
        PXSIG_FORMAT: '',
        PXSIG_URL: 'http://127.0.0.1:1',
        PXSIG_BIN: rustBin,
        PXSIG_WORKSPACE: '',
        PXSIG_PROJECT: '',
      },
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (status) => ok({ status, stdout, stderr }));
  });

const story = { id: 'a--b', title: 'A', name: 'B', importPath: 'src/A/A.stories.tsx' };

test('manifestWarnings: a missing srcRoot, and stories none of which is under the project', () => {
  const root = tree({ 'src/A/A.stories.tsx': '' });
  const P = /** @type {Project} */ (
    /** @type {unknown} */ ({ workspaceRoot: root, root, srcRoot: join(root, 'src') })
  );
  const from = 'http://127.0.0.1:9/index.json';
  assert.deepEqual(manifestWarnings(P, [{ importPath: 'src/A/A.stories.tsx' }], from), []);
  assert.deepEqual(manifestWarnings(P, [], from), [], 'an empty index is reported elsewhere');
  const away = { ...P, srcRoot: join(root, 'lib') };
  assert.deepEqual(manifestWarnings(away, [{ importPath: '../other/B.stories.tsx' }], from), [
    'srcRoot lib does not exist (pxsig.config.json "srcRoot")',
    `none of the 1 stories in ${from} is under .: is it this project's Storybook? (storybook.url, storybook.configDir)`,
  ]);
});

test(
  'manifest names the Storybook it read, in Markdown and in JSON',
  { skip: !chromium && 'no Chromium' },
  async () => {
    const sb = await fakeStorybook([story]);
    try {
      const root = tree({
        'pxsig.config.json': { srcRoot: 'src', storybook: { url: sb.url } },
        'src/A/A.stories.tsx': '',
      });
      const md = await run(['manifest'], root);
      assert.equal(md.status, 0, md.stderr);
      assert.match(md.stdout, new RegExp(`· from ${sb.url}/index\\.json`));
      assert.doesNotMatch(md.stdout, /warning:/);
      const json = await run(['manifest', '--json'], root);
      assert.equal(json.status, 0, json.stderr);
      const r = JSON.parse(json.stdout);
      assert.deepEqual(r.source, { url: `${sb.url}/index.json`, staticDir: null });
      assert.deepEqual(r.warnings, []);
      // Another package's Storybook: nothing under srcRoot (exit 2 as before), and the error says
      // which index it read and that none of its stories is in this project.
      const other = tree({
        'pxsig.config.json': { srcRoot: 'lib', storybook: { url: sb.url } },
      });
      const miss = await run(['manifest'], other);
      assert.equal(miss.status, 2);
      assert.match(miss.stderr, new RegExp(`in the Storybook index at ${sb.url}/index\\.json`));
      assert.match(miss.stderr, /srcRoot lib does not exist/);
    } finally {
      sb.close();
    }
  }
);

test(
  'manifest from a static build names the folder it served',
  { skip: !chromium && 'no Chromium' },
  async () => {
    const preview = `<!doctype html><html><body><div id="storybook-root"></div><script>window.__STORYBOOK_PREVIEW__ = { storeInitializationPromise: Promise.resolve(), storyStoreValue: { loadStory: async () => ({ parameters: { pxsig: {} }, tags: [], playFunction: null }) } };</script></body></html>`;
    const root = tree({
      // Port 1 never answers: the build is served instead.
      'pxsig.config.json': {
        srcRoot: 'src',
        storybook: { url: 'http://127.0.0.1:1', staticDir: 'storybook-static' },
      },
      'src/A/A.stories.tsx': '',
      'storybook-static/iframe.html': preview,
      'storybook-static/index.json': {
        v: 5,
        entries: { 'a--b': { ...story, type: 'story', importPath: './src/A/A.stories.tsx' } },
      },
    });
    const json = await run(['manifest', '--json'], root);
    assert.equal(json.status, 0, json.stderr);
    const r = JSON.parse(json.stdout);
    assert.equal(r.source.staticDir, join(realpathSync(root), 'storybook-static'));
    assert.match(r.source.url, /^http:\/\/127\.0\.0\.1:\d+\/index\.json$/);
    const md = await run(['manifest'], root);
    assert.match(md.stdout, /· from storybook-static \(served at http:\/\/127\.0\.0\.1:\d+\)/);
  }
);
