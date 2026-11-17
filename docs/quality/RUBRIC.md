# Release rubric

How a pxsig release candidate is graded before its tag is pushed. The `release-assessor` agent
(`.claude/agents/release-assessor.md`) applies it; a person can apply it by hand the same way.

The rubric is public. Scored reports are private: they live outside the repository's history, in
a git-ignored folder, and are never committed, attached to a release or posted on GitHub. The release
waits on the owner's go after reading the report. This is not a CI gate.

## Scale

Each dimension gets a score from 0 to 10, in half points.

| Score | Meaning                                                                                   |
| ----- | ----------------------------------------------------------------------------------------- |
| 10    | Every item holds, with evidence for each. Nothing to fix.                                 |
| 8     | Every gate passes. Minor findings with a known fix, none user-visible.                    |
| 6     | Gates pass, but there is a real gap: a missing check, a stale doc, a measured regression. |
| 4     | A gate is red or skipped, or a user-visible defect is open with no fix in progress.       |
| 2     | Several gates red, or a safety property is untested.                                      |
| 0     | The dimension cannot be assessed, or it is broken in what ships.                          |

A score between anchors is allowed when the evidence sits between them. Say which anchor it is
nearest and why.

## Evidence rules

- Every score cites at least one of: `file:line` at the graded commit, a command with the line of
  its output that matters, a CI run id, or a commit sha.
- Nothing from memory, from an earlier report or from a document's claim alone. A doc says what
  should be true; the command or the code says what is.
- A command that could not run is recorded as **not run** with the reason (no Docker, no design
  system checkout, no token). Not run is never a pass. A dimension that depends on it scores at
  most 6 for that item.
- A test skipped for a missing prerequisite (`no Chromium`, `Rust binary not built`) counts as not
  run.
- A flaky result (passes on re-run) is a finding, with both run ids.
- Numbers are copied from output, never rounded in pxsig's favor.

## Overall

The overall is the unweighted mean of the dimension scores, truncated (not rounded) to one
decimal. A dimension that is not assessed counts as 0. Blockers are listed apart from the score:
a release with any blocker waits, whatever the overall.

## Blockers

Any one of these holds the release until it is fixed or the owner records an exception in
writing:

1. A required check (the 11 jobs of `ci.yml`, as `scripts/required-checks.mjs` lists them) is
   missing, failed or still running on the release commit.
2. `node scripts/check-versions.mjs --tag vX.Y.Z` fails.
3. A high or critical vulnerability in what ships (the `pxsig` package and its runtime
   dependencies, the platform binaries, the addon, the bundled dashboard), from `pnpm audit --prod`,
   `cargo deny`, an open Dependabot alert on a runtime dependency, or a Socket issue, with no
   dated ignore entry that gives a reason.
4. An open high or critical code-scanning alert on shipped code, or in a workflow that publishes
   (`release.yml`, `image.yml`), that is not dismissed with a reason.
5. A regression in the approval guard: an MCP tool that approves or accepts; bulk approval not
   refused under CI, a pipe or an assistant's marker; the server accepting a foreign origin or a
   host that is not loopback; `approve verify` passing a baseline with no log line. A test that
   held one of these and was removed or weakened since the previous tag counts as a regression.
6. A regression in mask controls: a masks change that is approved or written without
   `--allow-masks`, or a mask over 50% of the capture or on the story root that can be written.
7. Provenance missing: `release.yml` no longer attests, no longer publishes with trusted
   publishing (`id-token: write`, environment `npm`), or the previous release's files fail
   `gh attestation verify`.
8. The screens workflow is red on the release commit, or a locked structure or geometry file
   fails, or pxsig's own screens have any alignment, source parity or top-bar finding.
9. A front-end regression on a shipped screen: a new axe or layout finding from
   `pxsig dashboard check --strict`, a Lighthouse accessibility score lower than the previous
   report's on the same page, or a page whose CLS rises above 0.1 or LCP above 2.5 s.
10. A breaking or behavior-change entry with no `To update:` line, or a minor or major release
    with no "Upgrading to X.Y" section in `docs/migrating.md`.
11. A home path, user name, email or token in a packed file, the dashboard's data or an API
    response, or `node scripts/check-clean.mjs` failing.
12. A release that changes gate defaults without a gate noise run on the release commit with no
    false positives (`docs/releasing.md`, "Gate noise").
13. The benchmark release gate fails (`scripts/bench/release-gate.mjs`).

## Dimensions

### 1. Architecture

The Rust engine (`crates/`) owns signatures, comparison and the `.psig` format; Node
(`packages/pxsig`) owns capture, the CLI, the server and MCP; the dashboard reaches components only
through the UI contract (`packages/dashboard/src/ui/`). Check: no comparison logic duplicated in
Node; `src/lib/spawn.mjs` is still the only `node:child_process` importer in shipped code; views
import only from `@ui` (`pnpm ui:check`); formats (spec v1, `.psig`, status codes, exit codes) changed
only with a version bump.

### 2. Front end and React

The dashboard (`packages/dashboard`) and the addon's panel, assessed as a staff front-end engineer
would.

- **Web vitals and Lighthouse.** On the dashboard as it ships (built on the design system at the
  committed pin; a plain build is not assessed) served with demo data: LCP, CLS, INP (TBT as the lab proxy) and Lighthouse performance, accessibility
  and best-practices scores, for the Overview and the inspector at least. Record per page, with
  tool versions. A regression against the previous report is a finding.
- **Accessibility beyond axe.** Keyboard paths through the main flows, focus order, focus return
  after the inspector closes, landmarks, reduced motion, contrast in both themes. axe and the
  locked structure files are evidence; Lighthouse accessibility is a second opinion.
- **React implementation.** Render counts and wasted renders on the main flows (the capture hook
  in `packages/pxsig/src/lib/capture/react-hook.mjs` counts them), effects that derive state,
  state placement, context fan-out, memoization that is missing or pointless, virtualization for
  large stores, Suspense and transitions, bundle splitting, React 19 idioms.
- **React Compiler.** Run the compiler over the dashboard sources (the engine's `react-compile`,
  or `babel-plugin-react-compiler` as a second opinion). Record which functions compile, which bail
  out and why, and whether adopting it is worth it. Evidence from the run only.
- **Top bar.** `pxsig dashboard check` sweeps the bar from 1440 down to 390 and back (the
  `top-bar` rule): one line, the documented collapse order, wider never shows fewer, no sideways
  scroll. Every adapter's `conformance.json` `topBar` field, as `pxsig dashboard gaps` reports it.
- **Bundle.** The dashboard's size as shipped (the release's `pxsig-dashboard.tar.gz`; the
  served first load, `assets/app.js` with the common chunks it imports; the parts loaded on first
  use; the classic `classic/assets/app.js`), against the previous release.
- **Crud and atrophy.** Dead exports, duplicated helpers, views that reach past the contract,
  stale flags, deprecated APIs still used, tests that assert nothing.

### 3. Dependencies and supply chain

Socket scores and issues for each published package (`pxsig`, `@pxsig/storybook-addon`, the five
`@pxsig/cli-*` packages); `cargo deny --locked check` (`deny.toml`: advisories, licenses, sources);
`pnpm audit --prod --audit-level high`; open Dependabot alerts; frozen lockfiles in every job;
`playwright` and `react` kept as optional peers; actions pinned by full sha; the release SBOMs and
their osv-scanner step. Without a Socket token, score from local evidence only and say so.

### 4. Security

The approval guard and its tokens (`SECURITY.md`, `docs/server.md`, `docs/mcp.md`, and the tests
behind each claim); mask bypass controls; open code-scanning alerts on `main`, each triaged as
shipped, workflow or test code; secret handling in workflows (no secret echoed, `NPM_TOKEN` absent
once trusted publishing is set); trusted publishing and provenance; `SECURITY.md` matches the code
(spot-check three rows of its capability table); no paths, names or emails in the UI or API;
Socket alerts on what ships.

### 5. Types and static analysis

`pnpm typecheck` (the dashboard and adapters, and `checkJs` over the shipped JavaScript with its
ratchet `scripts/type-errors-baseline.json`); `pnpm lint` and `pnpm lint:ratchet`;
`pnpm format:check`; `cargo fmt --all --check`; `cargo clippy ... -D warnings`;
`pnpm lint:workspace`. Score the trend of both baselines since the previous tag.

### 6. Tests

`cargo test --workspace --locked`, `pnpm -r test`, `node --test scripts/*.test.mjs`, the
dashboard's flow tests, the examples end to end, the old-version compatibility job, and the
coverage floors in `packages/pxsig` (`test:coverage`). All three OSes green on the release commit.
Skips and flakes are findings.

### 7. pxsig's own screens

The dashboard's fixture screens and live screens, checked in pxsig's pinned container
(`docker/screens-image.json`) on the design system at the commit pinned in `design-system.json`: no changed,
new or failed screen; locked structure (`fixtures/locked/**/*.aria.yml`) and geometry
(`geometry.json`) hold; no axe, layout, alignment or top-bar finding; source parity has no
difference; the live flows repeat without a
not-deterministic step; `packages/dashboard/.pxsig/approvals.ndjson` covers every baseline
(`pxsig approve verify`).

### 8. Performance

Check time per entry and per run (CI logs, the examples job); the nightly benchmark's medians
and budgets (`docs/benchmark.md`, the `bench-results` artifact) and the release gate; approval
cost (the benchmark's `plan` step); npm package sizes against the previous release; CI wall time
per workflow over the last 20 runs on `main`; the screens image size. The dashboard's own load
performance is scored in dimension 2.

### 9. Governance ratchets

`check-clean`, changelog fragments (`changelog.mjs check`), file size (`check-file-size.mjs --all`
and its baseline trend), the lint and type ratchets, `ui:check`, commitlint over the release range,
husky hooks present and not bypassed, required check names unchanged (`required-checks.test.mjs`),
link check.

### 10. Product maturity

Score one point per item that holds, with evidence:

1. **Gate calibration.** Defaults have recorded evidence (`tools/calibrate*.mjs`, gate noise runs)
   on Linux, macOS and Windows; margins stated.
2. **Determinism.** The text determinism workflow and the live screens' `--repeat` pass; same input
   gives the same signature on every OS.
3. **Approval trail.** Every approval logged with hashes and version; `approve verify --since`
   catches a rewritten log; undo works; no identity in the log.
4. **Mask controls.** Mask changes are their own class, need `--allow-masks`, large or root masks
   are refused, `masksLarge` warns, and each is tested.
5. **MCP limits.** The tool list in `docs/mcp.md` matches the server's tool list; none approves;
   `pxsig_review` needs `confirm: true`.
6. **Versioning and upgrade notes.** `To update:` lines, `docs/migrating.md` for each minor,
   versions agree.
7. **Packaging.** ESM only, no install scripts, `publint` clean (as `release.yml` runs it), each tarball's self-test passes
   (`test/installed/`), `install-smoke.mjs` passes.
8. **Docs checked against code.** Help pages, `docs/ui/features.md`, `docs/agents.md` and links are
   generated or tested, not hand-kept.
9. **Adapter contract versioning.** `CONTRACT_VERSION`, `contract-changes.md`, the reference
   adapter's `conformance.json` and the lock agree.
10. **Deprecation path.** Every deprecated flag, key or export warns, names its replacement and has
    a changelog entry under Deprecated.

### 11. Documentation and agent context

`README.md`, `QUICKSTART.md`, `docs/`, `CLAUDE.md`, `CONTRIBUTING.md` and the MCP server's
instructions agree with the code. Spot-check at least five claims (a flag, a default, an exit code,
an endpoint, a tool) against the source, and cite each.

### 12. Developer experience

Clone to green from a fresh worktree following `CONTRIBUTING.md` only; `pnpm bootstrap --check`;
`pxsig doctor` on the dashboard's own store; hooks install with `pnpm install`; how a worktree gets
the design system at the pinned commit is documented and works; time from clone to a passing
`pnpm test`.

## Commands

Run on the commit being graded, from a clean checkout at that commit. They may create git-ignored
build output (`node_modules/`, `target/`, `packages/pxsig/dist/`) and nothing else; `git status
--porcelain` must be unchanged at the end. Locally, cargo must be the pinned toolchain
(`rust-toolchain.toml`): put rustup's toolchain first on `PATH` (`rustup which cargo` shows it).

```bash
# State
git rev-parse HEAD && git status --porcelain && git describe --tags --always
node scripts/check-versions.mjs [--tag vX.Y.Z]
pnpm bootstrap --check

# Gates
pnpm install --frozen-lockfile
pnpm lint && pnpm lint:ratchet && pnpm format:check && pnpm lint:workspace
pnpm typecheck
node scripts/check-clean.mjs
node scripts/changelog.mjs check && node scripts/changelog.mjs preview
node scripts/check-links.mjs
node scripts/check-file-size.mjs --all
node scripts/ui.mjs check && node scripts/ui.mjs gaps
pnpm exec commitlint --from <previous tag> --to HEAD
pnpm audit --prod --audit-level high

# Rust
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-features --locked
cargo deny --locked check
cargo build --release --locked -p pxsig-cli --features react-oxc

# Tests and packaging
pnpm --filter pxsig exec playwright install chromium
pnpm test
pnpm --filter pxsig run test:coverage
node scripts/examples-test.mjs
node scripts/install-smoke.mjs
node scripts/bench/run.mjs
for f in <packed pxsig and addon .tgz>; do npx --yes publint@0.3.25 run "$f" --level warning --strict; done

# pxsig's own screens (Docker; the design system at the pin in design-system.json)
pnpm ds:fetch
pnpm build:dashboard
pnpm screens:check
cd packages/dashboard && node ../pxsig/bin/pxsig.mjs approve verify
cd packages/dashboard && node ../pxsig/bin/pxsig.mjs doctor --offline

# Front end
node packages/pxsig/bin/pxsig.mjs dashboard check --build packages/pxsig/dist/dashboard --strict
node scripts/showcase-shots.mjs --serve            # demo data; prints its URL
npx --yes lighthouse@13.6.0 <url> --preset=desktop --output=json --output-path=<report dir>/lh-<page>.json
#   CHROME_PATH from Playwright's Chromium; web-vitals@6.2.3 injected with Playwright for CLS/INP
target/release/pxsig react-compile < <request.json> # the dashboard's .tsx sources, docs/cli.md

# CI facts (read-only)
gh run list -R hydrotik/pxsig -w <workflow> -c <sha> --json databaseId,name,conclusion
gh api --paginate --slurp repos/hydrotik/pxsig/commits/<sha>/check-runs > <report dir>/runs.json
node scripts/required-checks.mjs <report dir>/runs.json
gh api 'repos/hydrotik/pxsig/code-scanning/alerts?state=open&ref=refs/heads/main&per_page=100'
gh api 'repos/hydrotik/pxsig/dependabot/alerts?state=open&per_page=100'
gh run download <bench run id> -R hydrotik/pxsig -n bench-results -D <report dir>/bench
gh attestation verify <file from the previous release> --repo hydrotik/pxsig
npm view <package>@<version> dist.unpackedSize dist.fileCount

# Socket (GET only; token from SOCKET_TOKEN, never printed)
printf 'user = "%s:"\n' "$SOCKET_TOKEN" | curl -sS --fail-with-body --config - \
  "https://api.socket.dev/v0/npm/<package>/<version>/score"
printf 'user = "%s:"\n' "$SOCKET_TOKEN" | curl -sS --fail-with-body --config - \
  "https://api.socket.dev/v0/npm/<package>/<version>/issues"
```

Scoped package names are URL-encoded (`@pxsig%2Fcli-linux-x64`). The token never appears in a
URL, a log, the report or a file, and no request carries an email, name or other identity.

## Report

One Markdown file per graded commit, in the report folder for that date and version (git-ignored,
never committed), with the raw outputs beside it. Sections, in order:

1. **Header.** Date, version, commit sha, branch, working-tree state, previous report graded.
2. **Gates.** A table: command, exit code, the output line that matters, time.
3. **Scores.** A table: dimension, score, one-line basis.
4. **Overall.** The mean as computed above.
5. **Blockers.** Numbered, each naming the blocker rule and its evidence. "None" when none.
6. **Evidence.** Per dimension, the citations behind the score.
7. **Change since the previous report.** Score deltas with reasons. A re-grade that corrects an
   earlier mistake is labeled **correction**, not counted as progress.
8. **Top fixes.** Ranked; each with effort (S, M, L) and whether it needs the owner.

## Changes to this rubric

- **2026-11-16.** The design system comes from the pin in `design-system.json`; alignment, source
  parity and top-bar findings on pxsig's own screens are a blocker; the top bar is assessed under
  front end.
- **2026-11-13.** First version: twelve dimensions, thirteen blockers, the command list, the
  report format, Socket scores.
