### Breaking changes

- **`pxsig/workspace` exports only the documented resolver.** The export is now
  `src/public/workspace.mjs` with five names: `openProject`, `findWorkspace`, `pickProject`,
  `loadProject` and `SetupError`, the functions the README describes as the resolver. The other 27
  names it used to carry (`DEFAULTS`, `CONFIG_FILE`, `WORKSPACE_FILE`, `PXSIG_VERSION`, `expand`,
  `flagLayer`, `setFlagLayer`, `merge`, `provenance`, `resolveModes`, `missingProjects`,
  `satisfies`, `unlistedConfigs`, `workspaceProblems`, `engineProblems`, `engineVersion`,
  `imageProblems`, `parseImageTag`, `componentOfImport`, `entryConfig`, `runManifest`,
  `writeRunManifest`, `browserFile`, `resolvePeer`, `rustBinary`, `serverFile`, `serverUrlFor`) were
  never documented and were pxsig's own internals; nothing in the Storybook addon or the examples
  imported them through the package.
  To update: code that imported one of the 27 reads what it needs from the project
  `openProject()` returns (its resolved config and store paths) or from `pxsig config --json`, or
  opens an issue naming what it needs.
- **`pxsig/dashboard` is types only at run time.** Its `types` condition still points at the UI
  contract, so `import type * as C from 'pxsig/dashboard'` is unchanged. Loading it in Node used to
  fail with a syntax error from the `.ts` source; it now throws `pxsig/dashboard is types only`.
  To update: import it with `import type` only.

### Behaviour changes

- **React is declared as an optional peer (`react >=19`).** `pxsig/diff-viewer` and
  `pxsig dashboard build` use the project's React; the dashboard's UI contract passes `ref` as a
  prop, which needs React 19. Package managers now warn when a project has an older React
  installed; projects without React are unaffected.
  To update: use React 19 with `pxsig/diff-viewer` and `pxsig dashboard build`, or accept the
  warning.

### Documentation

- **The README lists every export.** `pxsig/diff-viewer` is TypeScript source for a bundler that
  compiles TypeScript and JSX (such as the Vite build `pxsig dashboard build` runs), not for Node.
