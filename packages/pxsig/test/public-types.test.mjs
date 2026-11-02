// The hand-written declarations for `pxsig/workspace` and `pxsig/psig` (src/public/*.d.mts) match
// the JavaScript they describe. The check is the type-check: `pnpm typecheck` (check-types.mjs)
// compiles this file with checkJs, so a parameter, option or return type that differs between a
// declaration and its implementation, or a name one has and the other lacks, is a tsc error here.
// The declarations come in through the package's own `types` conditions (`pxsig/...`); the
// implementations from the modules that define them (src/public/workspace.mjs only re-exports, and
// tsc would read its .d.mts sibling instead). At run time the test checks that each subpath exports
// exactly the names its declarations do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as psigImpl from '../src/lib/psig.mjs';
import * as workspaceLib from '../src/lib/workspace.mjs';
import * as workspaceImpl from '../src/public/workspace.mjs';
/** @import * as Psig from 'pxsig/psig' */
/** @import * as Workspace from 'pxsig/workspace' */

/**
 * `true` when A and B are the same type (not just assignable: an option one side lacks counts).
 * @template A, B
 * @typedef {(<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false} Same
 */
/** @typedef {typeof Workspace} DeclaredWs */
/** @typedef {typeof Psig} DeclaredPsig */
/** @typedef {Pick<typeof workspaceLib, keyof DeclaredWs>} ImplWs */
/** @typedef {'code' | 'choices'} Extra SetupError's fields its constructor copies from `extra`. */

/**
 * Each declared function against its implementation, and the name sets both ways. A `false` in
 * any slot, or a missing or extra name, fails to compile.
 * @type {{
 *   ws: { [K in Exclude<keyof DeclaredWs, 'SetupError'>]: Same<DeclaredWs[K], ImplWs[K]> },
 *   psig: { [K in keyof DeclaredPsig]: Same<DeclaredPsig[K], (typeof psigImpl)[K]> },
 *   psigNames: Same<keyof DeclaredPsig, keyof typeof psigImpl>,
 *   setupError: Same<Omit<Workspace.SetupError, Extra>, InstanceType<ImplWs['SetupError']>>,
 *   setupErrorExtra: Same<Pick<Workspace.SetupError, Extra>, NonNullable<ConstructorParameters<ImplWs['SetupError']>[1]>>,
 * }}
 */
const SAME = {
  ws: { findWorkspace: true, pickProject: true, loadProject: true, openProject: true },
  psig: { readHeader: true, readSection: true, readImage: true, hasImage: true },
  psigNames: true,
  setupError: true,
  setupErrorExtra: true,
};

/**
 * SetupError's constructor, by assignment both ways (a class's static side is not compared by
 * `Same`). Never called: tsc checks the assignments.
 * @param {DeclaredWs['SetupError']} Declared
 */
function sameSetupErrorConstructor(Declared) {
  /** @type {DeclaredWs['SetupError']} */
  const ctor = workspaceLib.SetupError;
  /** @type {ImplWs['SetupError']} */
  const ctorBack = Declared;
  return [ctor, ctorBack];
}

test('the public modules export exactly the names their declarations do', () => {
  void sameSetupErrorConstructor;
  assert.deepEqual(
    Object.keys(workspaceImpl).sort(),
    ['SetupError', ...Object.keys(SAME.ws)].sort()
  );
  assert.deepEqual(Object.keys(psigImpl).sort(), Object.keys(SAME.psig).sort());
});
