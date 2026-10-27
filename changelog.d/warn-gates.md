### Added

- **Warn mode.** `enforcement` in `pxsig.config.json` (or the workspace file's `defaults`) sets
  each gate to `enforce` (as before) or `warn`: `visual` (`check`), `a11y`, `verify` (`approve
  verify`'s baselines with no log line), `env` (`--strict-env`'s refusal), `doctor`, `stale`. A
  warned gate runs the same checks on the same selection and exits `advisoryExit` (0, or 10 to 125)
  where only it would have failed. It says so everywhere: ADVISORY first and last lines on the
  CLI, `enforcement` and `git.head` in `check.json` (with the gates each status context carries),
  a lead block in `summary.md`, a `pxsig.enforcement` property in `junit.xml`, `enforcement` and
  `wouldFail` in `history.ndjson`, the setup codes `enforcement-warn`, `enforcement-ending` and
  `enforcement-expired` in `pxsig doctor` and the dashboard banner, an `Enforcement` row in
  `doctor`, a `Warn mode` row in `status`, the gate table in `pxsig config`, and MCP fields
  (`pxsig_status.enforcement`, `pxsig_check`'s `enforcement` and `wouldFail`, `pxsig_history`'s
  `wouldFail`). Setup errors and person-only refusals are never warned; a mismatched baseline or a
  rewritten log fails `approve verify` in every mode. Only committed config, or `--warn` from a
  person at a terminal, lowers a gate; `--enforce` and `PXSIG_ENFORCEMENT=enforce` raise one for
  anyone; `PXSIG_ENFORCEMENT=warn` is refused. `warnUntil` ends warn mode on a date, announced
  from `noticeDays` before. Each warned run adds a line to a readiness tally in the repository's
  state folder outside the repository (shared by every worktree; 90 days, 5,000 lines per project
  and gate set).
- **`--sarif <file>`** on `check --full` and `pxsig a11y`: new axe violations as SARIF 2.1.0, for
  code-scanning viewers. Changes no exit code.

### Behaviour changes

- **New axe violations are a gate on `warn` by default.** With no `enforcement` key every exit
  code and report is as before, except when a run finds a new violation (one not on an entry's
  accepted list): `check` then prints one `[pxsig] ADVISORY: would have failed (exit 1): N entries
  with new a11y violations. Not blocking.` line, `summary.md` opens with an advisory lead and
  `check.json` carries `enforcement`. The exit stays 0 and no readiness line is written.
  `enforcement.gates.a11y: "off"` removes it; `"enforce"` makes new violations fail the run
  ([migrating.md](docs/migrating.md)).
