### Added

- **TypeScript types for `pxsig/workspace` and `pxsig/psig`.** Both exports now carry a `types`
  condition, so a TypeScript project gets the resolver's and the `.psig` reader's signatures
  (`Project`, `Workspace`, `PsigHeader`, …) instead of `any`. A test compiles a consumer against
  the installed layout.
