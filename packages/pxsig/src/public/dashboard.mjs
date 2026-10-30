/**
 * `pxsig/dashboard` at run time. The export is the dashboard's UI contract, which is TypeScript
 * types only (`import type * as C from 'pxsig/dashboard'`); its `types` condition points at the
 * contract source. Nothing in it runs, so loading it in Node throws this instead of a syntax error
 * from the `.ts` file.
 */
throw new Error(
  "pxsig/dashboard is types only: import it from TypeScript with `import type * as C from 'pxsig/dashboard'`"
);
