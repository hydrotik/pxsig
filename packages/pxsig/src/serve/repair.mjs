/**
 * serve/repair.mjs — the safe repairs, as the dashboard's button asks for them: the plan, or the
 * plan applied, its re-checks going through the server's own queue.
 */
import { reconcile, writeLedger } from '../lib/integrity.mjs';
import { applyRepairs, defaultHooks, planRepairs } from '../lib/repair.mjs';
import { enqueue } from './checks.mjs';
import { httpError } from './http.mjs';
import { needLock } from './projects.mjs';
/** @import { ServeContext } from '../types/serve.js' */
/** @import { ProjectState } from './projects.mjs' */

/**
 * Safe repairs, as the dashboard's button asks: plan, or apply (never prune, never approve).
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {{ apply?: boolean, only?: unknown, stale?: boolean }} [opts] `only`: the request's, any JSON value
 */
export async function repair(srv, S, { apply = false, only: onlySteps, stale = false } = {}) {
  const ledger = await reconcile(S.ctx, { affected: S.affected });
  const plan = planRepairs(ledger, {
    only: Array.isArray(onlySteps)
      ? onlySteps.filter((/** @type {unknown} */ a) => a !== 'prune')
      : undefined,
    prune: false,
    server: { up: true },
    stale,
  });
  if (!apply) return { plan };
  needLock(srv, S);
  if (S.repairing) throw httpError(409, 'a repair is already running');
  const hooks = {
    ...defaultHooks(S.ctx, { serverUrl: srv.url }),
    // Re-checks go through this server's own queue (warm browsers), then wait for it to drain.
    /** @param {string[]} ids */
    async recheck(ids) {
      const from = S.runs;
      await enqueue(srv, S, { ids });
      while (S.running || S.queued.size)
        await (S.running ?? new Promise((r) => setTimeout(r, 200)));
      // A run that failed (Storybook down, a broken index) recorded nothing: say so.
      if (S.lastFailure && S.lastFailure.seq > from) throw new Error(S.lastFailure.error);
      return { via: 'server' };
    },
  };
  S.repairing = applyRepairs(S.ctx, plan, {
    hooks,
    via: 'dashboard',
    reconcileOpts: { affected: S.affected },
  });
  try {
    const res = await S.repairing;
    S.integrity = res.ledger;
    writeLedger(S.ctx, res.ledger);
    srv.broadcast('integrity', {
      project: S.name,
      summary: res.ledger.summary,
      setup: res.ledger.setup,
    });
    srv.broadcast('data', { project: S.name });
    console.log(
      `[serve] ${S.name}: repair: ${res.steps.map((s) => `${s.action} → ${s.result}`).join(' · ') || 'nothing to do'}`
    );
    return { plan, applied: res.steps, summary: res.ledger.summary };
  } finally {
    S.repairing = null;
  }
}
