#!/usr/bin/env node
/**
 * mcp-call.mjs — call the pxsig MCP server (src/mcp.mjs) over stdio, as an MCP client would.
 *
 *   node <pxsig>/src/mcp-call.mjs                                   # list the tools
 *   node <pxsig>/src/mcp-call.mjs pxsig_status '{"project":"ui"}'
 *   node <pxsig>/src/mcp-call.mjs pxsig_entry '{"id":"components-toast--default"}' --images-to out/
 *
 * `<pxsig>` is the installed package (`node_modules/pxsig`) or `packages/pxsig` in a clone. Run it
 * in the workspace (or set PXSIG_WORKSPACE): the server it starts resolves projects from there.
 * Prints text content; with --images-to <dir>, writes image content there as PNGs. Exit 1 when the
 * tool reports an error. For scripts, CI and agents without MCP support, and for testing the server.
 */
import { spawn } from './lib/spawn.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/** @import { Readable, Writable } from 'node:stream' */
/** @import { McpToolResult, McpToolsList, RpcReply } from './types/t6.js' */

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const imgIdx = argv.indexOf('--images-to');
const imagesTo = imgIdx >= 0 ? argv.splice(imgIdx, 2)[1] : null;
const [tool, rawArgs] = argv;

const proc = spawn(process.execPath, [join(here, 'mcp.mjs')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
/** @type {Map<number, (msg: RpcReply<unknown>) => void>} */
const pending = new Map();
let seq = 0;
// stdio is ['pipe', 'pipe', …]: the child's stdin and stdout are streams.
createInterface({ input: /** @type {Readable} */ (proc.stdout) }).on('line', (line) => {
  // A line from pxsig's own MCP server (src/mcp.mjs): one JSON-RPC reply.
  const msg = /** @type {RpcReply<unknown>} */ (JSON.parse(line));
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});
/**
 * Send one request; resolves with the server's reply.
 * @template R The result's shape for `method` (docs/mcp.md).
 * @param {string} method
 * @param {Record<string, unknown>} params
 * @returns {Promise<RpcReply<R>>}
 */
const call = (method, params) =>
  new Promise((ok) => {
    const id = ++seq;
    // The reply to `id` is the reply to this method: its result has the shape R.
    pending.set(id, /** @type {(msg: RpcReply<unknown>) => void} */ (ok));
    /** @type {Writable} */ (proc.stdin).write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
    );
  });

const init = await call('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'mcp-call', version: '0' },
});
if (init.error) throw new Error(init.error.message);
/** @type {Writable} */ (proc.stdin).write(
  `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
);

let code = 0;
if (!tool) {
  /** @type {RpcReply<McpToolsList>} */
  const res = await call('tools/list', {});
  for (const t of res.result.tools) console.log(`${t.name}\n  ${t.description}\n`);
} else {
  /** @type {RpcReply<McpToolResult>} */
  const res = await call('tools/call', {
    name: tool,
    arguments: rawArgs ? JSON.parse(rawArgs) : {},
  });
  if (res.error) {
    console.error(res.error.message);
    code = 1;
  } else {
    let n = 0;
    for (const c of res.result.content) {
      if (c.type === 'text') console.log(c.text);
      else if (c.type === 'image' && imagesTo) {
        mkdirSync(imagesTo, { recursive: true });
        const p = join(imagesTo, `${tool}-${++n}.png`);
        writeFileSync(p, Buffer.from(c.data, 'base64'));
        console.log(`[image → ${p}]`);
      } else if (c.type === 'image')
        console.log(`[image ${c.mimeType}, ${Math.round((c.data.length * 3) / 4 / 1024)} KB]`);
    }
    if (res.result.isError) code = 1;
  }
}
proc.kill();
process.exit(code);
