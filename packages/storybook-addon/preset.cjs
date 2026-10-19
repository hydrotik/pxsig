/**
 * pxsig Storybook addon preset. Register it in `.storybook/main` as `addons: ['@pxsig/storybook-addon']`,
 * or with options: `{ name: '@pxsig/storybook-addon', options: { server: 'http://127.0.0.1:6070' } }`.
 *
 * The manager page learns where the pxsig server is: the `server` option, else the address the
 * running server wrote for this workspace (node_modules/.cache/pxsig/server.json), else the
 * workspace's configured port. The panel probes them in that order.
 */
const fs = require('fs');
const path = require('path');

/** The workspace root above Storybook's config dir: a pxsig.workspace.json, else a pxsig.config.json. */
function workspaceOf(start) {
  let dir = path.resolve(start);
  let config = null;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pxsig.workspace.json'))) return dir;
    if (!config && fs.existsSync(path.join(dir, 'pxsig.config.json'))) config = dir;
    if (fs.existsSync(path.join(dir, '.git'))) return config ?? dir;
    const up = path.dirname(dir);
    if (up === dir) return config;
    dir = up;
  }
}

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

function servers(options) {
  const out = [];
  if (options?.server) out.push(String(options.server).replace(/\/$/, ''));
  const ws = options?.configDir ? workspaceOf(options.configDir) : null;
  if (ws) {
    const running = readJson(path.join(ws, 'node_modules', '.cache', 'pxsig', 'server.json'));
    if (running?.url) out.push(running.url);
    const port = readJson(path.join(ws, 'pxsig.workspace.json'))?.server?.port;
    if (port) out.push(`http://127.0.0.1:${port}`);
  }
  out.push('http://127.0.0.1:6070');
  return [...new Set(out)];
}

module.exports = {
  managerEntries: (entry = []) => [...entry, path.join(__dirname, 'manager.mjs')],
  managerHead: (head, options) => `${head ?? ''}<script>window.__PXSIG__=${JSON.stringify({ servers: servers(options) })}</script>`,
};
