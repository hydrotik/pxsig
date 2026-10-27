### Added

- **`pxsig dashboard check`**: every dashboard feature's screens rendered on a project's adapter
  build (`pxsig dashboard build`), from sample data that ships with pxsig, in both themes, with
  Playwright's Chromium. It writes a gallery (`node_modules/.cache/pxsig/dashboard-check/index.html`)
  that sets each screen beside the same screen on the prebuilt reference dashboard, plus
  `report.json` and `summary.md`, and runs axe on each screen. Axe findings are advisory;
  `--strict` makes any of them fail. Exit 1 when a screen does not render (its landmark never
  appears, or the page throws); 2 with no build, no Chromium, or an adapter for an older major UI
  contract. It reads no project data, answers the dashboard's requests itself (nothing is written)
  and writes only its output folder. `--only <feature,…>` and `--themes` narrow it; `--reference
  <dir>` names another dashboard to compare against. It replaces the hand walk-through in
  docs/ui/build-adapter.md "Verify" (kept as the fallback without Chromium).
- **Screens in the feature registry.** Each feature in the dashboard's `src/ui/features.ts` lists
  the screens the check renders (a sample scenario, an address, clicks, and the landmark that shows
  it rendered); `node scripts/ui.mjs check` fails a feature without one. The sample scenarios
  (`fixtures/scenarios.mjs`) are shared with the dashboard's own browser tests.
- `examples/custom-ui` gains `pnpm dashboard:check`, and the end-to-end examples run it on every
  pull request, on macOS, Linux and Windows.

No behaviour change: a new subcommand; nothing else reads the new files.
