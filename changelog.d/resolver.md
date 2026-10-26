### Behaviour changes

- **Selection follows every kind of import** (docs/ci.md, "What counts as an import"). The graph
  used by `check --since/--changed`, `pxsig affected`, `pxsig_affected` and `pxsig_check` now
  reads:
  - any imported file type (`.json`, `.svg`, `.md?raw`, fonts, images), CSS `@import`, `@use`,
    `@forward` and `url()`, `export … from`, `new URL('…', import.meta.url)`,
    `import.meta.glob`, `require.context`, `url()` in strings, and template-literal imports;
  - the TypeScript source behind a `.js` specifier, `tsconfig.json` `paths` and `baseUrl`,
    `package.json` `imports`, and the project's own and workspace packages through `exports`, a
    build output mapped back to its source;
  - imports from the Storybook config and other "affects every entry" folders: a file only
    `preview.tsx` imports (a global style sheet, the font faces) now selects every entry, where
    it selected nothing.
  More entries are selected than before, never fewer.
- **Unresolved imports are checked on every run.** An import pxsig cannot follow (a `virtual:`
  module, an unknown alias, a computed `import()`) adds the entries that reach its file to every
  run, and every entry when that file affects every entry (a fail-safe line, class
  `unresolved`). `pxsig affected` lists them. Watch and staleness leave them out.

### Added

- `affects.aliases` (specifier prefix → path) for aliases only a bundler knows, and
  `affects.unresolved` (globs) to accept a file's unresolved imports.
- `affected --json` gains `unresolved` and `remote`; `pxsig_affected` returns the unresolved
  imports that add entries.
