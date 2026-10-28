/**
 * test/types.d.ts — declarations the test suites need and no source module gives. Types only:
 * nothing here runs. A script file (no import or export), so the module below is ambient; a test
 * reads it with `/// <reference path="./types.d.ts" />`.
 */

/**
 * The catalog as an installed pxsig exports it (package.json `exports`): the test lays the package
 * out in a temp folder, so tsc cannot resolve it from the repository. docs/ui/catalog/ holds it.
 */
declare module 'pxsig/ui/catalog/hydrotik.json' {
  const catalog: { components: unknown[] };
  export = catalog;
}
