/**
 * tools/act.mjs — the tools that act: pxsig_check, pxsig_review, pxsig_doctor.
 */
import { spawn } from '../lib/spawn.mjs';
import { join } from 'node:path';
import { CODES } from '../lib/integrity.mjs';
import { AGENT_DECISIONS, NEEDS_PERSON, readToken, TOKEN_HEADER } from '../lib/guard.mjs';
import { acquireLock, describeLock, readLock } from '../lib/lock.mjs';
import { ctxOf, here, http, ID_RE, load, PROJECT, server } from './context.mjs';
import { affected } from './staleness.mjs';
import { doctor, summarizeIds } from './doctor.mjs';

/** @import { Readable } from 'node:stream' */
/** @import { LockError } from '../lib/lock.mjs' */
/** @import { LockState } from '../types.js' */
/** @import { CheckArgs, CheckToolResult, DoctorArgs, ReviewArgs, ServerCheckReply, ServerStatusReply } from '../types/t6.js' */

// A const array: each tool keeps its literal name, so types/t6.d.ts can name a tool's result.
export const actTools = /** @type {const} */ ([
  {
    name: 'pxsig_check',
    description:
      'Re-render and re-check entries, then report their results. Select by `ids`, `stories`, `changed_files` (import graph), `since` (git ref), or `all`. A story (or entry) not in the manifest yet is registered first when Storybook is healthy: its entries arrive NEW, with no signature, for a person to approve; anything that cannot be registered is listed in `skipped` with the reason. Uses the running pxsig server (fast, warm browsers); without it, runs the check itself (needs the project Storybook). Never writes baselines.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        ids: { type: 'array', items: { type: 'string' } },
        stories: { type: 'array', items: { type: 'string' } },
        changed_files: { type: 'array', items: { type: 'string' } },
        since: { type: 'string' },
        all: { type: 'boolean' },
        timeout_s: { type: 'number', default: 900 },
      },
      additionalProperties: false,
    },
    /**
     * @param {CheckArgs} args
     * @returns {Promise<CheckToolResult>}
     */
    async run({
      project,
      ids = [],
      stories = [],
      changed_files,
      since,
      all = false,
      timeout_s = 900,
    }) {
      const C = ctxOf(project);
      const sel = new Set(ids);
      if (changed_files?.length || since)
        for (const id of affected(C, { files: changed_files, since }).ids) sel.add(id);
      if (!sel.size && !stories.length && !all)
        return { checked: 0, note: 'nothing selected (the files affect no entries?)' };
      const srv = await server(C);
      const t0 = Date.now();
      if (srv.up) {
        // Registering a new story reads its parameters in a browser first: allow for that.
        /** @type {ServerCheckReply} */
        const res = await http(C, '/__pxsig/check', {
          method: 'POST',
          body: { project: C.P.name, ids: [...sel], stories, all, via: 'mcp' },
          timeout: 120_000,
        });
        const queued = new Set(res.queued ?? []);
        const extra = {
          ...(res.registered?.length ? { registered: res.registered } : {}),
          ...(res.skipped?.length ? { skipped: res.skipped } : {}),
        };
        if (!queued.size)
          return {
            checked: 0,
            ...extra,
            note: res.skipped?.length
              ? 'nothing queued: every name was skipped (see skipped)'
              : 'nothing queued: no entry matches the selection',
          };
        // Wait for the queue to drain.
        for (;;) {
          await new Promise((r) => setTimeout(r, 1500));
          /** @type {ServerStatusReply | null} */
          const s = await http(C, '/__pxsig/status', { timeout: 5000 }).catch(() => null);
          if (s && !s.running && !s.queued) break;
          if (Date.now() - t0 > timeout_s * 1000)
            return {
              timedOut: true,
              queued: queued.size,
              note: 'still running; call pxsig_status later',
            };
        }
        return { ...summarizeIds(C, queued, 'server', t0), ...extra };
      }
      const args = [join(here, 'check.mjs'), '--project', C.P.name, '--retries', '1'];
      // Ids and stories together (both name entries to --only; new ones are registered there).
      if (sel.size || stories.length) args.push('--only', [...sel, ...stories].join(','));
      /** @type {{ code: number | null, log: string }} */
      const out = await new Promise((ok) => {
        const p = spawn(process.execPath, args, { cwd: C.root, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = '';
        // stdio is ['ignore', 'pipe', 'pipe']: stdout and stderr are streams.
        /** @type {Readable} */ (p.stdout).on('data', (/** @type {Buffer} */ d) => (log += d));
        /** @type {Readable} */ (p.stderr).on('data', (/** @type {Buffer} */ d) => (log += d));
        const kill = setTimeout(() => p.kill(), timeout_s * 1000);
        p.on('exit', (code) => {
          clearTimeout(kill);
          ok({ code, log: log.split('\n').slice(-25).join('\n') });
        });
      });
      if (out.code === 2) throw new Error(`check setup error:\n${out.log}`);
      const want = new Set(
        load(C)
          .check.rows.filter(
            // A row without a story matches by id only (includes / has of undefined are false).
            (r) =>
              all ||
              sel.has(r.id) ||
              stories.includes(/** @type {string} */ (r.story)) ||
              sel.has(/** @type {string} */ (r.story))
          )
          .map((r) => r.id)
      );
      const skipped = [...out.log.matchAll(/^\[check\] not checked: (\S+): (.+)$/gm)].map((m) => ({
        name: m[1],
        why: m[2],
      }));
      return {
        ...summarizeIds(C, want, 'check', t0),
        ...(skipped.length ? { skipped } : {}),
        // Run here, not by the server on the port: it serves another workspace.
        ...(srv.foreign ? { note: srv.foreign } : {}),
        log: out.log,
      };
    },
  },
  {
    name: 'pxsig_review',
    description:
      "Mark entries for attention. reject: the entry's visual change is marked rejected (to be fixed); a11y-reject: its axe violations are marked for a fix; unreview / a11y-unreview: clear a rejection. Approving and accepting are not here: they need a person (the dashboard, or `pxsig approve` in a terminal), and the server refuses an agent's unreview of a person's approval or accept. A decision lasts until the entry's next check and is logged as via: mcp. Pass confirm: true ONLY when the user explicitly asked for this action on these exact entries in this conversation. Needs the pxsig server.",
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        action: { type: 'string', enum: [...AGENT_DECISIONS] },
        ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        confirm: {
          type: 'boolean',
          description: 'true only on an explicit user instruction for these ids.',
        },
      },
      required: ['action', 'ids', 'confirm'],
      additionalProperties: false,
    },
    /** @param {ReviewArgs} args */
    async run({ project, action, ids, confirm }) {
      if (!AGENT_DECISIONS.has(action))
        throw new Error(
          `refused: ${action} is not an agent's decision (${[...AGENT_DECISIONS].join(', ')}); ${NEEDS_PERSON}`
        );
      if (confirm !== true)
        throw new Error(
          'refused: review actions need confirm: true, given only on an explicit user instruction for these ids'
        );
      const bad = ids.filter((id) => !ID_RE.test(id));
      if (bad.length) throw new Error(`bad ids: ${bad.join(', ')}`);
      const C = ctxOf(project);
      const srv = await server(C);
      if (!srv.up) throw new Error(`the pxsig server is not running (${C.serverUrl}); ${srv.hint}`);
      // The server's MCP token (lib/guard.mjs): it lets this tool reject and clear rejections, nothing more.
      const token = readToken(C.P.workspaceRoot, C.serverUrl, 'mcp');
      if (!token)
        throw new Error(
          `no MCP token from the pxsig server at ${C.serverUrl} (it writes one when it starts): restart pxsig serve with this version`
        );
      /** @type {{ id: string, entry: unknown }[]} */
      const done = [];
      for (const id of ids) {
        /** @type {{ entry?: unknown }} */
        const r = await http(C, `/__pxsig/${action}`, {
          method: 'POST',
          body: { project: C.P.name, id },
          headers: { [TOKEN_HEADER]: token },
          timeout: 120_000,
        });
        done.push({ id, entry: r.entry ?? null });
      }
      return { action, done };
    },
  },
  {
    name: 'pxsig_doctor',
    description:
      "Integrity and coverage, per component: which stories have no coverage (unregistered), entries never checked, missing baseline images or renders, render errors, stale verdicts, orphaned baselines — each with a stable status code, a severity and the reason. Writes the project's reports/integrity.json. `repair: 'plan'` lists the safe repairs; `repair: 'apply'` runs them (register new stories in the manifest without signatures, re-check, add a missing baseline image to its .psig only where the latest render passes the signature gate). Repairs never change a signature, never approve and never prune.",
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        component: {
          type: 'string',
          description: 'Substring of the component folder, e.g. "Toast" or "components/Data".',
        },
        status: {
          type: 'string',
          description: `Status code(s), comma-separated: ${Object.keys(CODES).join(', ')}.`,
        },
        limit: { type: 'number', default: 40 },
        repair: { type: 'string', enum: ['none', 'plan', 'apply'], default: 'none' },
        only: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['register', 'recheck', 'restore-baseline-image', 'convert-legacy'],
          },
          description: 'Limit repairs to these actions.',
        },
        offline: {
          type: 'boolean',
          description: 'Do not fetch the Storybook index (static scan of the story files).',
        },
        stale: {
          type: 'boolean',
          description:
            'Also re-check entries whose verdict is stale (a warning; left out of the repairs by default).',
        },
      },
      additionalProperties: false,
    },
    /** @param {DoctorArgs} args */
    async run({
      project,
      component,
      status,
      limit = 40,
      repair = 'none',
      only,
      offline = false,
      stale = false,
    }) {
      if (repair !== 'apply')
        return doctor({
          project,
          component,
          status,
          limit,
          repair,
          only,
          offline,
          stale,
          via: 'mcp',
        });
      // Repairs write the store: through the server that holds its lock, or under the lock here.
      const C = ctxOf(project);
      const held = readLock(C.P);
      if (held && !held.stale && held.holder === 'serve' && !held.foreign) {
        /** @type {{ plan?: unknown, applied?: unknown }} */
        const body = await http({ ...C, serverUrl: held.url ?? C.serverUrl }, '/__pxsig/repair', {
          method: 'POST',
          body: { project: C.P.name, apply: true, only, stale },
          timeout: 30 * 60_000,
        });
        return {
          ...(await doctor({ project, component, status, limit, offline, via: 'mcp' })),
          plan: body.plan,
          applied: body.applied,
          via: 'server',
        };
      }
      let lock;
      try {
        lock = acquireLock(C.P, {
          holder: 'pxsig_doctor repair',
          command: 'pxsig mcp: pxsig_doctor repair apply',
        });
      } catch (e) {
        // acquireLock throws a LockError, which carries the lock it found (null: none)
        throw new Error(
          `${/** @type {LockError} */ (e).lock ? describeLock(C.P, /** @type {LockState} */ (/** @type {LockError} */ (e).lock)) : /** @type {Error} */ (e).message}: the repair did not run`
        );
      }
      try {
        return await doctor({
          project,
          component,
          status,
          limit,
          repair,
          only,
          offline,
          stale,
          via: 'mcp',
        });
      } finally {
        lock.release();
      }
    },
  },
]);
