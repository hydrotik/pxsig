/**
 * lib/react/doctor.mjs — what `pxsig doctor` says about React analysis. None changes its exit:
 *
 *   react-compiler (info)  the compiler and Babel versions found, not installed, or off and where
 *   react-config   (warn)  a bad `react` value, and the part it turns off until it is fixed
 *   react-flow     (info)  Flow files the last analysis did not compile
 *
 * Packages are named with their versions only, never their paths.
 */
import { join } from 'node:path';
import { readJson } from '../files.mjs';
import { configWarning, reactConfig } from './config.mjs';
import { BABEL, COMPILER, reactPeers } from './peers.mjs';

/** @import { Project } from '../../types.js' */
/** @import { ReactReport } from '../../types/react.js' */

/** @typedef {{ code: 'react-compiler' | 'react-config' | 'react-flow', severity: 'info' | 'warn', text: string }} ReactFinding */

/**
 * @param {Project} P
 * @returns {ReactFinding[]}
 */
export function reactFindings(P) {
  const cfg = reactConfig(P, { flags: {} });
  /** @type {ReactFinding[]} */
  const out = cfg.problems.map((p) => ({
    code: /** @type {const} */ ('react-config'),
    severity: /** @type {const} */ ('warn'),
    text: p,
  }));
  // A bad value that turns the compiler analysis (or everything) off: its line says so.
  if (configWarning(cfg)) return out;
  if (cfg.off)
    return [
      ...out,
      { code: 'react-compiler', severity: 'info', text: `React analysis is off (${cfg.off})` },
    ];
  if (!cfg.compiler)
    out.push({
      code: 'react-compiler',
      severity: 'info',
      text: 'compiler analysis is off (react.compiler: false)',
    });
  else {
    const peers = reactPeers(P);
    const missing = [peers.compiler ? null : COMPILER, peers.babel ? null : BABEL].filter(Boolean);
    out.push({
      code: 'react-compiler',
      severity: 'info',
      text:
        peers.compiler && peers.babel
          ? `${COMPILER} ${peers.compiler.version} with ${BABEL} ${peers.babel.version}`
          : `${missing.join(' and ')} not installed: compiler analysis skipped`,
    });
  }
  const last = /** @type {ReactReport | null} */ (
    readJson(join(P.store.reports, 'react.json'), null)
  );
  const flow = (last?.skipped ?? []).filter((s) => s.why === 'a Flow file').length;
  if (flow)
    out.push({
      code: 'react-flow',
      severity: 'info',
      text: `${flow} Flow files not analysed (Flow is not supported)`,
    });
  return out;
}
