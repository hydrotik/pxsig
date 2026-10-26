### Behaviour changes

- **`pxsig approve verify` is strict by default.** A baseline with no line in `approvals.ndjson`
  now fails (exit 1), where it was listed and passed. The failure names the entries and prints the
  exact `pxsig approve verify --adopt` command, which a person runs once for baselines from before
  the log existed. `--no-strict` keeps the old result. `pxsig doctor` warns first
  (`verify-unlogged`); see docs/migrating.md. An entry with no baseline yet is no longer counted
  as one "without a log entry".
- **`pxsig check` stops on a conflicted store.** A merge or rebase that left baselines or store
  files conflicted makes `check` exit 2 with the files and the steps, and `doctor` reports
  `store-conflict` (an error). docs/ci.md gains "Rebasing with baselines".
- **`summary.md` gains one line when a `check --since` range changed baselines**: "Baselines
  changed in this PR: N (… approved in the dashboard, … in the terminal, … via MCP)", naming any
  assistant marker on those lines, never a person.

### Added

- `pxsig approve verify --since <ref>`: fails when the approval log was rewritten rather than
  appended to since the merge base, or when there is no merge base. `--suite <name>` and
  `--all-suites` verify suite manifests; a suite whose manifest is not committed is listed, not
  failed. `--adopt` takes `--suite` / `--all-suites` too.
- `pxsig approve log --trace`: the commit that added each batch's lines and the pull request that
  merged it, from git. It prints no names or emails.
- Docs: the required-check recipe runs `approve verify --all-suites --since`, checks everything on
  every push to main and nightly, and keeps one `pxsig-drift` issue for failures there;
  `local-ci.md` has a cron and a launchd example; "Publishing the report", "Repository size", and
  a roles table in `codeowners.md`. SECURITY.md lists every MCP tool and what it can change.
