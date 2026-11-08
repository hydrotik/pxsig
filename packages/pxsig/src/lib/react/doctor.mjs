/**
 * lib/react/doctor.mjs — what `pxsig doctor` says about React analysis. None changes its exit:
 *
 *   react-compiler (info)  the compiler a run would use and why (react.compiler), its version, what
 *                          is not installed, or off and where
 *   react-config   (warn)  a bad `react` value, and the part it turns off until it is fixed
 *   react-flow     (info)  Flow files the last analysis did not compile
 *
 * Packages are named with their versions only, never their paths.
 */
import { join } from 'node:path';
import { readJson } from '../files.mjs';
import { backendOf, compilerName, missingFor, oxcVersion } from './backend.mjs';
import { configWarning, reactConfig } from './config.mjs';
import { reactPeers } from './peers.mjs';

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
  else if (backendOf(cfg) === 'oxc') {
    // Asked of the engine: one built without the react-oxc feature has no built-in compiler.
    const v = oxcVersion(P.rustBin);
    out.push({
      code: 'react-compiler',
      severity: 'info',
      text:
        'version' in v
          ? `${compilerName({ name: 'oxc', compiler: v.version })}: react.compiler is "oxc"`
          : `react.compiler is "oxc", but ${v.why}: compiler analysis skipped`,
    });
  } else {
    const peers = reactPeers(P);
    const missing = missingFor(P, cfg, peers);
    const why =
      cfg.choice === 'babel'
        ? 'react.compiler is "babel"'
        : 'react.compiler is "auto", which uses the project\'s Babel plugin';
    out.push({
      code: 'react-compiler',
      severity: 'info',
      text: !missing.length
        ? `${compilerName({ name: 'babel', compiler: peers.compiler?.version, babel: peers.babel?.version })}: ${why}`
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
