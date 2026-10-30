#!/usr/bin/env node
/**
 * mcp.mjs — pxsig as an MCP server: the visual-regression status, one story's
 * diff images, and the check / review actions, for an agent.
 *
 *   pxsig mcp                       # stdio; register it with your MCP client, from the repo root
 *   claude mcp add pxsig -- npx pxsig mcp
 *
 * Model Context Protocol over stdio (newline-delimited JSON-RPC 2.0), written
 * without dependencies so it ships inside the pxsig package as-is.
 *
 * Projects: the server works on the workspace it starts in (or PXSIG_WORKSPACE). Every tool takes
 * an optional `project`; with several projects it is required (`pxsig_projects` lists them).
 *
 * Sources of truth, in order:
 * - the project's <store>/reports/check.json + review.json + history.ndjson: every
 *   producer (check, the server) writes them, so reads never need a server.
 * - the pxsig server when it is up (its address from node_modules/.cache/pxsig/server.json):
 *   whether a check is running, and the actions that need its warm browser pool
 *   and Rust engine (re-check, reject). Approving is never the MCP's: the server refuses it.
 * - Without the server, `pxsig_check` runs check.mjs itself (slower: a cold
 *   browser) and review actions are refused.
 *
 * Approving writes a baseline, which is the owner's decision: `pxsig_review`
 * refuses unless `confirm: true`, and its description tells the model to pass
 * that only when the user asked for these exact entries.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { findWorkspace } from './lib/workspace.mjs';
import { ctxOf, doctor, imageOf, PROBLEMS, prunePlan, tools } from './tools/index.mjs';
import { text } from './tools/context.mjs';

/** @import { RpcRequest } from './types/t6.js' */

// pxsig's own package.json
const VERSION = /** @type {{ version: string }} */ (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
).version;
/** @param {...string} a */
const log = (...a) => process.stderr.write(`[pxsig-mcp] ${a.join(' ')}\n`);

// --- MCP over stdio ---------------------------------------------------------------------------------

/** @param {{ id: RpcRequest['id'], result?: unknown, error?: { code: number, message: string } }} msg */
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

/** @param {RpcRequest} msg */
async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications: initialized, cancelled
  try {
    if (method === 'initialize') {
      return send({
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'pxsig', version: VERSION },
          instructions:
            "pxsig is the visual-regression harness for this repo. Start with pxsig_projects (when there are several) and pxsig_status; pxsig_list then pxsig_entry show what changed, with images. Approving and accepting are the person's: never approve, never accept, and never call `/__pxsig/approve`; ask the person to review in the dashboard.",
        },
      });
    }
    if (method === 'ping') return send({ id, result: {} });
    if (method === 'tools/list')
      return send({
        id,
        // Every field of a tool but its handler.
        result: {
          tools: tools.map((t) =>
            Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'run'))
          ),
        },
      });
    if (method === 'tools/call') {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool)
        return send({ id, error: { code: -32602, message: `unknown tool ${params?.name}` } });
      try {
        // The client's arguments go to the tool as they came, unchecked: an MCP client sends the
        // shape the tool's inputSchema names. `params` is set: a tool was found by its name.
        const out = await /** @type {(args: object) => Promise<unknown>} */ (tool.run)(
          /** @type {NonNullable<RpcRequest['params']>} */ (params).arguments ?? {}
        );
        // pxsig_entry answers with its own content; every other tool, with data
        const content = /** @type {{ content?: unknown }} */ (out)?.content ?? [text(out)];
        return send({ id, result: { content } });
      } catch (e) {
        return send({
          id,
          result: { content: [text(`Error: ${/** @type {Error} */ (e).message}`)], isError: true },
        });
      }
    }
    send({ id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (e) {
    send({ id, error: { code: -32603, message: /** @type {Error} */ (e).message } });
  }
}

// Imported (the pxsig CLI reuses the tools): no stdio loop. Run directly: serve MCP.
export { tools, ctxOf, PROBLEMS, doctor, prunePlan, imageOf };
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    /** @type {unknown} */
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ id: null, error: { code: -32700, message: 'parse error' } });
    }
    // A JSON-RPC request is an object: null, a number, a string or an array is not one.
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg))
      return send({ id: null, error: { code: -32600, message: 'invalid request' } });
    void handle(msg);
  });
  try {
    const ws = findWorkspace({});
    log(`ready · workspace ${ws.root} · projects ${ws.projects.map((p) => p.name).join(', ')}`);
  } catch (e) {
    log(`ready · no workspace here yet (${/** @type {Error} */ (e).message})`);
  }
}
