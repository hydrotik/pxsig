/**
 * dashboard-check/server.mjs — the sample images and the server for one build and one scenario,
 * for `pxsig dashboard check` (dashboard-check.mjs).
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, relative, resolve } from 'node:path';
import { PNG } from 'pngjs';
/** @import { ServerResponse } from 'node:http' */
/** @import { AddressInfo } from 'node:net' */
/** @import { CheckPost, DashboardFixtures, SampleImages, ScenarioServer } from '../types/t4.js' */

/**
 * The sample images: a card with a button, and the same card with the button moved, so the
 * inspector shows a baseline, a render and a diff with a real change in it.
 * @returns {SampleImages}
 */
export function sampleImages(width = 320, height = 200) {
  const draw = (
    /** @type {number} */ dx,
    /** @type {(x: number, y: number, dx: number) => number[]} */ paint
  ) => {
    const p = new PNG({ width, height });
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const [r, g, b] = paint(x, y, dx);
        p.data[i] = r;
        p.data[i + 1] = g;
        p.data[i + 2] = b;
        p.data[i + 3] = 255;
      }
    return p;
  };
  const scene = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ dx) => {
    const card = x >= 20 && x < width - 20 && y >= 20 && y < height - 20;
    const button = x >= 60 + dx && x < 180 + dx && y >= 120 && y < 152;
    return button ? [56, 112, 224] : card ? [236, 238, 242] : [200, 204, 212];
  };
  const baseline = draw(0, scene);
  const render = draw(16, scene);
  const diff = draw(0, (x, y) => {
    const i = (y * width + x) * 4;
    const same =
      baseline.data[i] === render.data[i] &&
      baseline.data[i + 1] === render.data[i + 1] &&
      baseline.data[i + 2] === render.data[i + 2];
    return same ? [236, 238, 242] : [214, 48, 48];
  });
  return {
    baseline: PNG.sync.write(baseline),
    render: PNG.sync.write(render),
    diff: PNG.sync.write(diff),
  };
}

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

/**
 * A server for one build and one scenario: the build under /report/, /__pxsig/ from the scenario,
 * images under /p/demo/. `posts` records every POST; none reaches anything that writes.
 * @param {{ dir: string, scenario: string, fixtures: DashboardFixtures, images: SampleImages, posts: CheckPost[] }} opts
 * @returns {Promise<ScenarioServer>}
 */
export function scenarioServer({ dir, scenario, fixtures, images, posts }) {
  /** @type {Set<ServerResponse>} */
  const open = new Set();
  const server = createServer((req, res) => {
    open.add(res);
    res.on('close', () => open.delete(res));
    // A request the server received always has its url.
    const u = new URL(/** @type {string} */ (req.url), 'http://x');
    const send = (
      /** @type {number} */ status,
      /** @type {string} */ type,
      /** @type {string | Buffer} */ body
    ) => res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
    if (u.pathname.startsWith('/__pxsig/')) {
      const name = u.pathname.slice('/__pxsig/'.length);
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (/** @type {Buffer} */ c) => (body += c));
        req.on('end', () => {
          /** @type {unknown} */
          let parsed = null;
          try {
            parsed = JSON.parse(body || 'null');
          } catch {
            parsed = body;
          }
          posts.push({ scenario, name, body: parsed });
          send(200, 'application/json', JSON.stringify({ ok: true }));
        });
        return;
      }
      if (name === 'events') {
        if (scenario === 'offline') return send(503, 'text/plain', 'offline');
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        return res.write('retry: 600000\nevent: hello\ndata: {}\n\n');
      }
      if (name === 'data') {
        if (scenario === 'loading') return; // the data never arrives: the loading line stays
        if (scenario === 'load-error')
          return send(500, 'application/json', JSON.stringify({ error: fixtures.LOAD_ERROR }));
        try {
          return send(200, 'application/json', JSON.stringify(fixtures.scenarioData(scenario)));
        } catch (e) {
          // scenarioData throws an Error for an unknown scenario.
          return send(
            500,
            'application/json',
            JSON.stringify({ error: /** @type {Error} */ (e).message })
          );
        }
      }
      if (name === 'projects')
        return send(
          200,
          'application/json',
          JSON.stringify({
            projects:
              fixtures.SERVER_STATES.includes(scenario) || fixtures.SCENARIOS[scenario]
                ? fixtures.projectsOf(scenario)
                : [],
          })
        );
      return send(404, 'application/json', '{"error":"not found"}');
    }
    if (u.pathname.startsWith('/p/demo/')) {
      if (u.pathname.startsWith('/p/demo/sig/'))
        return send(
          200,
          'application/json',
          JSON.stringify({
            format: 'psig',
            entry: { id: decodeURIComponent(u.pathname.slice('/p/demo/sig/'.length)) },
          })
        );
      if (u.pathname.endsWith('.png'))
        return send(
          200,
          'image/png',
          u.pathname.includes('/diffs/')
            ? images.diff
            : u.pathname.includes('/base')
              ? images.baseline
              : images.render
        );
      return send(404, 'text/plain', '');
    }
    if (!u.pathname.startsWith('/report')) return send(404, 'text/plain', '');
    const rel = decodeURIComponent(u.pathname.replace(/^\/report\/?/, '')) || 'index.html';
    const file = resolve(dir, rel);
    if (relative(dir, file).startsWith('..') || !existsSync(file))
      return send(404, 'text/plain', '');
    if (rel === 'index.html' && scenario === 'static') {
      // As `pxsig report` writes it: the data inlined, marked static.
      const json = JSON.stringify({ ...fixtures.scenarioData('clean'), static: true }).replace(
        /</g,
        '\\u003c'
      );
      return send(
        200,
        TYPES['.html'],
        readFileSync(file, 'utf8').replace(
          /<script id="pxsig-data">[\s\S]*?<\/script>|<!--pxsig:data-->/,
          `<script id="pxsig-data">window.PXSIG=${json}</script>`
        )
      );
    }
    send(200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file));
  });
  return new Promise((/** @type {(s: ScenarioServer) => void} */ ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () =>
      ok({
        // Listening on a TCP port: the address is an AddressInfo.
        base: `http://127.0.0.1:${/** @type {AddressInfo} */ (server.address()).port}`,
        close: () => {
          for (const r of open) r.destroy();
          server.close();
        },
      })
    );
  });
}
