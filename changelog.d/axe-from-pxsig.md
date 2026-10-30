### Behaviour changes

- **The a11y pass uses pxsig's own axe-core, not the project's.** A project (or workspace root)
  with its own `axe-core` used to override the version pxsig declares, so a11y results could change
  when an unrelated tool bumped it. pxsig now resolves `axe-core` from its own install first, and
  falls back to the project's only when its own cannot be found. Nothing to do; to change the axe
  version, pin pxsig. New axe violations after upgrading come from that version change, not the
  stories.
- **The render environment records the axe-core version** as `axe` (a minor field), in each
  `.psig` header and in `check.json`; `pxsig dashboard check` writes it to `report.json`. A
  baseline written before this compares as `compatible` with `envDiff: ["axe"]`, never as a
  mismatch, and its `id` does not change. `env.ignore: ["axe"]` leaves it out.
