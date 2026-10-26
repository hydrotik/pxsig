### Added

- **A nightly scale benchmark.** `scripts/bench/run.mjs` generates a store the size of a large
  design system (2,742 baselines, 537 stories) and times `affected --since`, `list`, `doctor`,
  `approve plan` and the dashboard's data against fixed budgets and the last release's times
  (docs/benchmark.md). For maintainers: nothing in pxsig's behaviour changes.
