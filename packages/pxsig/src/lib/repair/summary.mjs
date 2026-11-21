/**
 * The repair plan the dashboard's button runs, and its summary: the steps that would act from the
 * dashboard, each with how many entries it covers. The server sends the summary with the ledger
 * (the `integrity` event, the data answer), so the button shows only when there is work to do.
 */
import { planRepairs } from './plan.mjs';
/** @import { Ledger, PlanOptions, RepairAction } from '../../types/t3.js' */

/**
 * What the dashboard asks for: never prune (a person at a terminal), stale verdicts only where a
 * later step needs a fresh render, through the running server.
 * @type {Readonly<PlanOptions>}
 */
export const DASHBOARD_PLAN = Object.freeze({ prune: false, server: { up: true }, stale: false });

/**
 * @typedef {{ action: RepairAction, count: number }} RepairSummaryStep
 * @typedef {{ entries: number, steps: RepairSummaryStep[] }} RepairSummary
 */

/**
 * The dashboard plan's runnable steps: not blocked (a register step with no running Storybook),
 * not a person's (prune, log-torn), and with entries to act on. `entries` counts each entry once.
 * @param {Ledger} ledger
 * @returns {RepairSummary}
 */
export function repairSummary(ledger) {
  const steps = planRepairs(ledger, DASHBOARD_PLAN).steps.filter(
    (s) => !s.blocked && !s.needsPerson && s.ids.length > 0
  );
  return {
    entries: new Set(steps.flatMap((s) => s.ids)).size,
    steps: steps.map((s) => ({ action: s.action, count: s.ids.length })),
  };
}
