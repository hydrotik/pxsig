/**
 * no-paths.test.mjs — what the server answers the dashboard carries no absolute path: not the
 * workspace's, not the home folder's (both name the user). Every GET the dashboard reads, on a
 * fixture project after a check, against a stand-in Storybook.
 *
 *   node --test packages/pxsig/test/no-paths.test.mjs
 *
 * Needs the Rust binary and Chromium; skipped without them.
 */
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { test } from 'node:test';
import { fixture } from './fixture.mjs';
import { needs, fakeStorybook, serve } from './server-helpers.mjs';

/**
 * The first `bytes` of a streamed answer (the event stream never ends on its own).
 * @param {string} url
 */
async function head(url, bytes = 4096) {
  const ac = new AbortController();
  const r = await fetch(url, { signal: ac.signal });
  const reader = /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (r.body?.getReader());
  let text = '';
  const until = Date.now() + 3000;
  while (text.length < bytes && Date.now() < until) {
    const { done, value } = await reader.read();
    if (done) break;
    text += Buffer.from(value).toString('utf8');
    if (text.includes('\n\n')) break;
  }
  ac.abort();
  return text;
}

test(
  'no answer the dashboard reads names the workspace folder or the home folder',
  { skip: needs },
  async () => {
    const f = fixture();
    const sb = await fakeStorybook(f.index.stories);
    const S = await serve(f, { storybook: sb.url });
    try {
      const r = await S.post('check', { all: true });
      assert.ok(r.status < 300, JSON.stringify(r.body));
      await S.idle();
      const q = '?project=fixture';
      const answers = {
        status: await (await fetch(`${S.base}/__pxsig/status`)).text(),
        projects: await (await fetch(`${S.base}/__pxsig/projects`)).text(),
        data: await (await fetch(`${S.base}/__pxsig/data${q}`)).text(),
        integrity: await (await fetch(`${S.base}/__pxsig/integrity${q}`)).text(),
        events: await head(`${S.base}/__pxsig/events`),
        report: await (await fetch(`${S.base}/report/`)).text(),
      };
      const forbidden = [f.repo, realpathSync(f.repo), homedir()].flatMap((p) => [
        p,
        JSON.stringify(p).slice(1, -1),
      ]);
      for (const [name, body] of Object.entries(answers)) {
        assert.ok(body.length > 0, `${name}: answered`);
        for (const p of forbidden)
          assert.ok(
            !body.includes(p),
            `${name} carries an absolute path (${p}):\n${body.slice(0, 400)}`
          );
      }
    } finally {
      S.stop();
      sb.close();
    }
  }
);
