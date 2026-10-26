### Added

- **The UI contract has a version.** `CONTRACT_VERSION` (1.0.0) in the dashboard's contract,
  separate from pxsig's; `docs/ui/contract-changes.md` lists each version. A UI adapter records the
  one it was written for in its `conformance.json` (`"contract": "1.0.0"`; without it, 1.0.0).
  `pxsig dashboard gaps` shows it against this pxsig's, and the build stamps both.
- **New tokens and icons can carry a default** (`TOKEN_DEFAULTS`, `ICON_DEFAULTS`), so adding one
  no longer breaks every adapter: an adapter that does not map it gets the default.
- **The contract is locked.** `src/ui/contract-lock.json` records it; `pnpm ui:check` fails when the
  contract changes without a version bump of the right size (major for a removed component or prop,
  a new required component, or a token or icon without a default) and a `contract-changes.md`
  section. `node scripts/ui.mjs lock` records a change.

### Behaviour changes

- **An adapter written for an older major UI contract is refused.** `pxsig dashboard gaps` reports
  it as a problem (exit 1) and `pxsig dashboard build` refuses (exit 2), printing the migration
  notes; `pxsig serve` does not serve a build for another major contract and keeps the prebuilt
  dashboard. With contract 1.0.0 this cannot happen yet: every existing adapter is a 1.0.0 adapter.
  An adapter written for an older minor version builds as before, with a line naming what falls
  back.
