/**
 * tools/index.mjs — pxsig's tools, in the order `tools/list` gives them: what the MCP server
 * (mcp.mjs) serves and the CLI runs in-process.
 */
import { actTools } from './act.mjs';
import { infoTools } from './info.mjs';
import { inspectTools } from './inspect.mjs';
import { readTools } from './read.mjs';

// Spreading the const groups keeps each tool's literal name (types/t6.d.ts).
export const tools = /** @type {const} */ ([
  ...readTools,
  ...inspectTools,
  ...actTools,
  ...infoTools,
]);
export { ctxOf, PROBLEMS } from './context.mjs';
export { doctor } from './doctor.mjs';
export { imageOf, prunePlan } from './staleness.mjs';
