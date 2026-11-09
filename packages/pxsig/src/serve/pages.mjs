/**
 * serve/pages.mjs — what the server serves besides its API: a project's renders, diffs and
 * baselines (`/p/<project>/…`), and the dashboard (`/report/…`) with its inline data removed.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pageHeaders } from '../lib/guard.mjs';
import { machinePath } from '../lib/machine.mjs';
import { readHeader, readImage } from '../lib/psig.mjs';
// A live binding: report.mjs `useDashboard` sets it to the folder serve.mjs chose.
import { dashboardDir } from '../report.mjs';
import { inside, json, sendFile, TYPES } from './http.mjs';
/** @import { IncomingMessage, ServerResponse } from 'node:http' */
/** @import { ServeContext } from '../types/serve.js' */

/**
 * /p/<project>/… : a project's renders, diffs, baseline images (out of the .psig) and headers.
 * @param {ServeContext} srv
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} name
 * @param {string} rest
 */
export function projectFile(srv, req, res, name, rest) {
  const S = srv.states.get(name);
  if (!S) return json(res, 404, { error: `no project "${name}"` });
  const { P } = S;
  /** @param {string} id */
  const entryOf = (id) => S.manifest.stories.find((e) => e.id === id);
  let m = rest.match(/^renders\/base\/(.+)\.png$/);
  if (m) {
    const e = entryOf(m[1]);
    const img = e && readImage(resolve(P.workspaceRoot, e.sig));
    if (!img) return json(res, 404, { error: 'no baseline image' });
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': img.length,
      'cache-control': 'no-cache',
    });
    return res.end(req.method === 'HEAD' ? undefined : img);
  }
  m = rest.match(/^sig\/(.+)$/);
  if (m) {
    const e = entryOf(m[1]);
    const h = e && readHeader(resolve(P.workspaceRoot, e.sig));
    return h ? json(res, 200, h) : json(res, 404, { error: 'no baseline' });
  }
  // reports/rejected/: the rejection packets (lib/rejections/packet.mjs), which hold the reasons.
  const roots = {
    'renders/': join(P.store.root, 'renders'),
    'diffs/': P.store.diffs,
    'reports/rejected/': join(P.store.reports, 'rejected'),
  };
  for (const [prefix, root] of Object.entries(roots)) {
    if (!rest.startsWith(prefix)) continue;
    if (prefix === 'reports/rejected/' && !sameOrigin(req, res))
      return json(res, 403, { error: 'rejection packets are served to the dashboard only' });
    const file = resolve(root, rest.slice(prefix.length));
    if (!inside(root, file) || !existsSync(file) || statSync(file).isDirectory())
      return json(res, 404, { error: 'not found' });
    return sendFile(req, res, file);
  }
  return json(res, 404, { error: 'not found' });
}

/**
 * A packet is the reviewer's own words: never to another origin (a Storybook's, which CORS lets
 * read the API). Drops the CORS header `cors` set, and refuses a request a browser marks as from
 * another site or origin.
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
function sameOrigin(req, res) {
  res.removeHeader('access-control-allow-origin');
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}

/**
 * /report/… : the dashboard's files; its index.html without the data a static build inlined.
 * @param {ServeContext} srv
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} path the decoded path, `/report` or under `/report/`
 */
export function reportFile(srv, req, res, path) {
  let file = resolve(dashboardDir, `.${path.slice('/report'.length) || '/'}`);
  if (!inside(dashboardDir, file)) return json(res, 403, { error: 'outside root' });
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file))
    return json(res, 404, {
      error: existsSync(dashboardDir)
        ? 'not found'
        : `the dashboard is not built (${machinePath(dashboardDir, { root: srv.ws.root })})`,
    });
  if (file === join(dashboardDir, 'index.html')) {
    // Served pages fetch live data: drop whatever a static build inlined.
    const html = readFileSync(file, 'utf8').replace(
      /<script id="pxsig-data">[\s\S]*?<\/script>/,
      ''
    );
    // No token is ever in the page: decisions carry the dashboard link's cookie instead.
    res.writeHead(200, {
      'content-type': TYPES['.html'],
      'cache-control': 'no-store',
      ...pageHeaders(srv.allowedOrigins),
    });
    return res.end(html);
  }
  return sendFile(req, res, file);
}
