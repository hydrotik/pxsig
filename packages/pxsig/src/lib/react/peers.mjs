/**
 * lib/react/peers.mjs — the React Compiler, Babel and React as the project has them installed.
 *
 * Optional peers: pxsig installs none of them. Each is looked up from the project's folder to the
 * workspace root, never in pxsig's own folder or above the workspace (a parent folder's
 * node_modules), so a project that does not have them never gets them by accident. Paths stay in this process: outputs name the
 * package and its version only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { insidePath } from '../paths.mjs';

/** @import { Project } from '../../types.js' */
/** @import { ReactPeer, ReactPeers } from '../../types/react.js' */

export const COMPILER = 'babel-plugin-react-compiler';
export const BABEL = '@babel/core';

/**
 * One package as the project would load it, or null: the first `node_modules/<name>` from the
 * project's folder up to the workspace root (a symlinked install, as pnpm makes, counts where the
 * link is). A copy above the workspace root (a parent folder's node_modules) does not count.
 * @param {Pick<Project, 'root' | 'workspaceRoot'>} P
 * @param {string} name
 * @returns {ReactPeer | null}
 */
export function findPeer(P, name) {
  for (let dir = P.root; ; dir = dirname(dir)) {
    const pj = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(pj)) {
      try {
        // The package's own package.json.
        const p = /** @type {{ name?: string, version?: string }} */ (
          JSON.parse(readFileSync(pj, 'utf8'))
        );
        const path = createRequire(join(dir, 'package.json')).resolve(name);
        if (p.name === name) return { path, version: String(p.version ?? '') };
      } catch {
        // unreadable, or no entry point: not usable
      }
      return null;
    }
    if (dir === P.workspaceRoot || insidePath(P.workspaceRoot, dir) == null || dir === dirname(dir))
      return null;
  }
}

/**
 * The compiler, Babel and React the project has.
 * @param {Pick<Project, 'root' | 'workspaceRoot'>} P
 * @returns {ReactPeers}
 */
export function reactPeers(P) {
  return {
    compiler: findPeer(P, COMPILER),
    babel: findPeer(P, BABEL),
    react: findPeer(P, 'react')?.version ?? null,
  };
}

/**
 * The compiler's `target` for `auto`: the major of the project's React (17, 18, 19), else 19.
 * @param {string | null} react
 * @returns {'17' | '18' | '19'}
 */
export function autoTarget(react) {
  const major = String(react ?? '').split('.')[0];
  return major === '17' || major === '18' ? major : '19';
}
