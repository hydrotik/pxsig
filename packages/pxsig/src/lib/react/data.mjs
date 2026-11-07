/**
 * lib/react/data.mjs — what the dashboard's `data.react` says: where the React analysis stands for
 * a project (on, off and where, not installed, a bad value, running in the server, failed,
 * skipped, results not saved, out of date), the last `reports/react.json`, and who wrote it.
 * The server adds what only it knows (`live`); a static report has no `react` unless there are
 * results to show.
 */
import { join } from 'node:path';
import { readJson } from '../files.mjs';
import { missingFor } from './backend.mjs';
import { configWarning, reactConfig } from './config.mjs';

/** @import { Project } from '../../types.js' */
/** @import { CheckReact, ReactData, ReactLive, ReactOff, ReactReport } from '../../types/react.js' */

/**
 * Where React is off, as the dashboard names it: the first switch that turns it off.
 * @param {Pick<Project, 'config' | 'configSources'>} P
 * @param {ReturnType<typeof reactConfig>} cfg
 * @returns {ReactOff | null}
 */
function offAt(P, cfg) {
  if (cfg.off === 'PXSIG_REACT=off') return { where: 'env', key: 'react' };
  if (cfg.off === '--no-react') return { where: 'flag', key: 'react' };
  if (cfg.off?.startsWith('react: false in'))
    return {
      where: cfg.off.endsWith('pxsig.workspace.json') ? 'workspace' : 'config',
      key: 'react',
    };
  if (!cfg.off && !configWarning(cfg) && !cfg.compiler)
    return {
      where: P.configSources?.react === 'workspace defaults' ? 'workspace' : 'config',
      key: 'react.compiler',
    };
  return null;
}

/**
 * The packages the chosen compiler needs and the project lacks (names only): none for
 * `react.compiler: "oxc"`, the engine's built-in compiler.
 * @param {Pick<Project, 'root' | 'workspaceRoot' | 'config' | 'configSources'>} P
 * @param {Pick<ReturnType<typeof reactConfig>, 'choice'>} [cfg]
 */
export const missingPeers = (P, cfg = reactConfig(P)) => missingFor(P, cfg);

/**
 * `data.react` for a project, or null for a static report with nothing to show.
 * @param {Project} P
 * @param {{ check?: { rows?: { renders?: unknown }[], react?: CheckReact } | null, live?: ReactLive | null }} [o]
 *   `check`: the check.json the page gets; `live`: the server's state (absent: a static report)
 * @returns {ReactData | null}
 */
export function reactData(P, { check = null, live = null } = {}) {
  // A run the server could not save (another process holds the store) is shown from memory.
  const report =
    live?.report ??
    /** @type {ReactReport | null} */ (readJson(join(P.store.reports, 'react.json'), null));
  if (!live && !report && !check?.rows?.some((r) => r.renders !== undefined)) return null;
  const cfg = reactConfig(P);
  const warning = configWarning(cfg);
  const off = offAt(P, cfg);
  const missing = live?.missing ?? missingPeers(P, cfg);
  const compiler = cfg.off
    ? 'off'
    : warning
      ? 'bad-config'
      : !cfg.compiler
        ? 'off'
        : missing.length
          ? 'not-installed'
          : live?.running
            ? 'running'
            : live?.error
              ? 'failed'
              : live?.skipped
                ? 'skipped'
                : 'ready';
  const checked = check?.react && 'summary' in check.react ? check.react : null;
  return {
    status: {
      compiler,
      renders: cfg.off ? 'off' : 'ready',
      off,
      missing: compiler === 'not-installed' ? missing : [],
      // Without the "[pxsig] " the warning line starts with.
      configWarning: warning ? warning.replace(/^\[pxsig\] /, '') : null,
      error: live?.error ?? null,
      held: live?.held ?? null,
      stale: live?.stale ?? null,
    },
    report,
    source: !report
      ? null
      : live?.report || live?.wrote === report.generatedAt
        ? 'server'
        : checked && JSON.stringify(checked.summary) === JSON.stringify(report.summary)
          ? 'check'
          : 'react-cli',
  };
}
