/**
 * tools/info.mjs — pxsig_help and pxsig_history.
 */
import { existsSync, readFileSync } from 'node:fs';
import { helpData, helpNames, lookup, nearestNames } from '../help.mjs';
import { ctxOf, PROJECT } from './context.mjs';

/** @import { HelpArgs, HistoryArgs, HistoryLine } from '../types/t6.js' */

// A const array: each tool keeps its literal name, so types/t6.d.ts can name a tool's result.
export const infoTools = /** @type {const} */ ([
  {
    name: 'pxsig_help',
    description:
      "pxsig's own help, read-only: a command (`check`, `approve apply`), a topic (`agents`, `approvals`, `exit-codes`, `platforms`, `dashboard`, `ci`), a setting (`gate.threshold`) or `global` (options every command takes). The same text as `pxsig help <name>`. Without `name`, the list of names.",
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'A command, `command subcommand`, topic, setting key or `global`.',
        },
      },
      additionalProperties: false,
    },
    /** @param {HelpArgs} [args] */
    async run({ name } = {}) {
      if (!name) return { names: helpNames() };
      const found = lookup(String(name).trim().split(/\s+/));
      if (!found)
        throw new Error(
          `no command, topic or setting "${name}"; nearest: ${nearestNames(String(name)).join(', ')}`
        );
      return helpData(found);
    },
  },
  {
    name: 'pxsig_history',
    description:
      'The last check runs (full and partial): when, how many entries, how many changed, and which.',
    inputSchema: {
      type: 'object',
      properties: { project: PROJECT, limit: { type: 'number', default: 10 } },
      additionalProperties: false,
    },
    /** @param {HistoryArgs} args */
    async run({ project, limit = 10 }) {
      const C = ctxOf(project);
      if (!existsSync(C.historyPath)) return { runs: [] };
      const lines = readFileSync(C.historyPath, 'utf8').trim().split('\n').slice(-limit);
      return {
        runs: lines.map((l) => {
          // a line the engine appended
          const h = /** @type {HistoryLine} */ (JSON.parse(l));
          const rows = Object.entries(h.rows ?? {});
          return {
            at: h.at,
            entries: h.summary?.stories ?? rows.length,
            failed: h.summary?.failed,
            failedIds: rows
              .filter(([, v]) => v[0] === 0)
              .map(([id]) => id)
              .slice(0, 20),
            ...('wouldFail' in h ? { wouldFail: h.wouldFail, enforcement: h.enforcement } : {}),
          };
        }),
      };
    },
  },
]);
