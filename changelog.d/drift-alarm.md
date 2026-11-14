### Behaviour changes

- **`drift` means the render differs from the baseline image.** An entry was `drift` when it
  passed with SSIM below 1, which a change too small for the signature's grid never reached. Each
  compared row now carries `differs` (on a passing row: whether any pixel of the render is not the
  baseline image's; `null` when a rule failed it or the baseline holds no image), and `drift` is a
  passing row with `differs: true`: in `pxsig list drift`, the ledger's `drift` code, the
  Storybook addon and the dashboard's Stories filter, now "Passing, but differs from the
  baseline" instead of "Any pixel drift (SSIM < 1)" (which also listed changed entries). A row
  without `differs` (written by an engine before 0.7.7) still drifts when its SSIM is below 1. The
  content cache's key changed, so the first check after the upgrade compares every entry again.
  To update: nothing to do; verdicts and exit codes are unchanged, and more entries can show as
  drift than before.

### Added

- **The drift alarm.** A passing entry keeps its old baseline, so a change the gate does not see
  passed with nothing recording it. Every check now counts the passing entries whose render
  differs from the baseline: check.json's `summary.drift` (`count`, `of`, `share`, `otherEnv`,
  `warnAt`, `warn`), a `[check] drift: 12 of 162 passing entries (7.4%) differ from their
  baseline, within the gate` line, a `Drift:` line in summary.md, one `pxsig/drift` note in
  `--sarif`, a `Drift` row in `pxsig doctor` (`drift` in `--json` and `pxsig_doctor`), and
  "Passing, but differs from the baseline" in the dashboard's Open Items while any entry drifts.
  Entries rendered in a different environment than their baseline are counted apart
  (`otherEnv`). When at least 5 passing entries drift and they are at least 20% of the passing
  entries, `pxsig doctor`, the dashboard's Coverage view, the check's line and summary.md warn
  (`drift-high`); `drift.warnAt` (`{ "count": 5, "share": 0.2 }`, at most 100 and 0.5) tunes it,
  and `integrity.severity` can raise it to error but not lower it. It changes no verdict and no
  exit code ([docs/integrity.md](../docs/integrity.md#drift)).
