/**
 * enforcement.mjs — warn mode: a per-gate choice between `enforce` (today) and `warn`.
 *
 * A gate in `warn` runs exactly the same checks on exactly the same selection; only the exit code
 * changes (to `advisoryExit`, default 0, where that gate alone would have failed) and every surface
 * says so: an ADVISORY lead and last line on the CLI, a lead block in `summary.md`, `enforcement` in
 * `check.json`, setup codes in `pxsig doctor` and the dashboard banner, MCP fields. Warn is never a
 * pass, and never narrows a selection.
 *
 *   visual   check rows not passing (changed, new, render error)
 *   a11y     new axe violations against a11y.json: `warn` by default, quiet unless one appears
 *            (docs/configuration.md#enforcement); `off` restores the output from before the gate
 *            existed
 *   verify   `approve verify`: only baselines with no log line (a mismatch or a rewritten log is
 *            never warned)
 *   env      `--strict-env`'s refusal: under warn the check renders and lists the mismatches
 *   doctor   findings at or above `--fail-on`
 *   stale    stale or inconsistent rows
 *
 * Setup errors (exit 2) and person-only refusals (exit 3) are never warned.
 *
 * Who can lower a gate to `warn` (docs/configuration.md#enforcement): the committed config
 * (`pxsig.config.json`, the workspace file's `defaults`), or a person at a terminal with `--warn`
 * for one run. Anything can raise one to `enforce`: `--enforce`, `PXSIG_ENFORCEMENT=enforce`. CI
 * variables, assistants and MCP tools can only make a run stricter.
 */
import { EnforcementError, resolveEnforcement } from './enforcement/resolve.mjs';
/** @import { EnforcementOptions, EnforcementProject } from '../types/t2.js' */
/** @typedef {import('./enforcement/readiness.mjs').StateOptions} StateOptions */

export {
  checkEnforcementConfig,
  EnforcementError,
  GATES,
  outcome,
  resolveEnforcement,
} from './enforcement/resolve.mjs';
export {
  describeEnforcement,
  enforcementProblems,
  lastLine,
  leadLine,
  reportBlock,
  speaks,
} from './enforcement/lines.mjs';
export { appendReadiness, readinessPath, readinessTally } from './enforcement/readiness.mjs';
export { checkCounts, checkFindings } from './enforcement/findings.mjs';

/**
 * For the CLIs: resolve, or print the refusal and exit with its code.
 * @param {EnforcementProject} P
 * @param {EnforcementOptions} opts
 * @param {(message: string, code?: number) => unknown} [print]
 */
export function resolveOrExit(P, opts, print = (m) => process.stderr.write(`pxsig: ${m}\n`)) {
  try {
    return resolveEnforcement(P, opts);
  } catch (e) {
    if (!(e instanceof EnforcementError)) throw e;
    print(e.message, e.exit);
    process.exit(e.exit);
  }
}

/**
 * Combine several projects' exits: a real failure beats an advisory exit (worst code wins).
 * @param {readonly { exit?: number, advisory?: boolean }[]} results
 */
export function combineExits(results) {
  const real = results.filter((r) => !r.advisory).map((r) => r.exit ?? 0);
  const worst = Math.max(0, ...real);
  if (worst > 0) return worst;
  return Math.max(0, ...results.filter((r) => r.advisory).map((r) => r.exit ?? 0));
}
