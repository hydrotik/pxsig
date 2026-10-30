# Contributing

Thank you for helping. This file covers setting up, testing and what a pull request needs.

## Setup

You need:

- Node.js 22.18 or later to work on the repository (`pnpm ui:check` and `pnpm ui:docs` read TypeScript
  with Node's type stripping). `.nvmrc` names it, so `nvm use` (or fnm, or Volta) picks it up; CI
  runs the latest 22.x. The published `pxsig` package needs Node.js 22 or later.
- pnpm 10 (the version is pinned in `package.json`; `corepack enable` picks it up). TypeScript 7 is a
  native compiler: `pnpm install` fetches the package for your platform.
- Rust 1.99.0, with cargo: `rust-toolchain.toml` pins it and rustup installs it, and
  `rust-version` in `Cargo.toml` declares it. A Rust that is not managed by rustup (Homebrew's, for
  one) ignores the pin; put the rustup toolchain first on `PATH`.

```bash
git clone https://github.com/hydrotik/pxsig
cd pxsig
pnpm install
cargo build --release          # target/release/pxsig, which the CLI finds in a source checkout
pnpm --filter pxsig exec playwright install chromium
```

The last line downloads Playwright's Chromium. The tests that render (the render environment, the
server flows, the capture helpers) need it and the engine binary from `cargo build --release`;
without either, those tests are skipped, with the reason (`no Chromium`, `Rust binary not built`)
in the output. A skip is not a pass, so CI installs both before the suite. On Linux, add `--with-deps` the first time, for the system libraries Chromium
needs.

Run the CLI from the clone:

```bash
node packages/pxsig/bin/pxsig.mjs --help
```

To try a change against a real project, link the package into that project
(`pnpm add -D link:<path-to-clone>/packages/pxsig`) and set `PXSIG_BIN` to the clone's
`target/release/pxsig`.

## Tests

```bash
pnpm test                                  # all of the below, in this order
cargo test --workspace --locked            # the engine and the binary
pnpm -r test                               # every package (node --test)
node --test scripts/*.test.mjs             # the repository's own scripts (release, changelog, clean)
```

One suite at a time:

```bash
pnpm --filter pxsig test                   # the CLI, the server, the MCP server, the help pages
pnpm --filter @pxsig/storybook-addon test  # the addon
pnpm --filter @pxsig/dashboard test        # the dashboard's flows against a mocked server
node --test packages/pxsig/test/help.test.mjs   # one file
node scripts/examples-test.mjs             # the examples, end to end (CI's Examples job)
node scripts/check-clean.mjs               # what must never be committed (below)
node scripts/check-links.mjs               # every relative link and #anchor in the Markdown resolves
node scripts/bench/run.mjs                 # the scale benchmark (docs/benchmark.md); CI runs it nightly
```

The Node tests build their fixtures (stories, manifests, PNGs) in temporary folders. Add tests the
same way: synthesise what you need in code. They find the engine at `target/release/pxsig`, or at
`PXSIG_BIN` when it is set.

## Lint and format

```bash
pnpm lint                      # oxlint (.oxlintrc.json): an error fails CI
pnpm lint:ratchet              # a file may not gain a warning (scripts/lint-warnings-baseline.json)
pnpm lint:workspace            # sherif: the workspace's package.json files agree
pnpm format                    # oxfmt (.oxfmtrc.json); pnpm format:check is the CI gate
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
```

The rules and the format are the same as the hydrotik monorepo's. oxfmt leaves alone the files a
tool reads or compares by their text: the UI contract (`contract.ts`, `tokens.ts`, parsed and
hashed by `pnpm ui:lock`), the generated UI docs and manifest, and `docs/agents.md`, whose recipes
must match what `pxsig setup` writes word for word. After fixing warnings, lower the baseline in
its own commit: `node scripts/check-lint-warnings.mjs --update`. A warning that is right to keep
gets an inline `oxlint-disable-next-line <rule> -- <reason>`, not a higher baseline.

`pnpm install` sets up the git hooks (husky): the pre-commit hook lints and formats the staged files, and the
commit-msg hook checks the subject against `commitlint.config.cjs`: `<type>(<scope>): <subject>`,
lower case after the scope, at most 100 characters. Never skip them with `--no-verify`.

## File size

A source or test file (`.js .mjs .cjs .jsx .ts .tsx .rs`, tests, stories and scripts included) has
at most 5,000 tokens: bytes / 4 of the file as staged. The files already over the limit are listed
at their recorded sizes in `scripts/file-size-baseline.json`, and none of them may grow. The
pre-commit hook runs `node scripts/check-file-size.mjs --staged` after lint-staged, and CI's clean
job runs `--all`. When a change would grow a file over the limit, keep the file from growing, or
first move one self-contained part out in its own commit; the hook's message gives the steps. After
a file shrinks, lower the baseline in its own commit: `node scripts/check-file-size.mjs --update`
(it never raises an entry). A generated or vendored file goes in the baseline's `exempt` map with
its reason, in its own commit. The script is the same file in pxsig and hydrotik.

## What never goes into this repository

This repository holds source, schemas, tests and documentation. `scripts/check-clean.mjs` fails
the build when a tracked file breaks one of these rules, and CI runs it on every push and pull
request:

- **No images, fonts or binaries.** No `.png`, `.jpg`, `.woff2`, `.wasm` and the like.
  One exemption: product screenshots in [`docs/product-shots/`](docs/product-shots/README.md),
  shot from the examples' demo data (no names, no paths), compressed, at most 1.5 MB each.
- **No baselines or run output.** No `.psig`, `.pxsig.json`, stores (`.pxsig/`, `__pxsig__/`),
  renders, diffs, reports, `target/` or `dist/`. Those belong to the projects under test.
- **No absolute home-directory paths.**
- **No names from other repositories or organisations.** The script also checks a denylist of
  names. The list is never committed or uploaded anywhere, because that would publish the names:
  it lives on the maintainer's machine, in `~/.config/pxsig/clean-terms` or a git-ignored
  `.clean-terms` at the root of the main checkout (one name per line, `#` for comments); worktrees
  find either. CI does not check names.

Names only come in from reading another repository, so the name check runs after that work, not on
every push. Read other repositories through the `peer-reader` agent (`.claude/agents/`), which
reports in neutral terms, and before pushing that branch or opening its pull request run `/scrub`
(`.claude/commands/`), or by hand:

```bash
node scripts/check-clean.mjs --require-terms --since origin/main --text pr-body.md
```

`--since` adds the branch's commit messages and `--text` a draft such as the PR body. A hit prints
where it is, never the name.

Run `node scripts/check-clean.mjs` by hand any time. With `--all` it checks every file on disk,
not only tracked ones.

In examples and docs use neutral names: `packages/ui`, `apps/storybook`, `my-design-system`.

## The dashboard

The dashboard is built from `packages/dashboard` into `packages/pxsig/dist/dashboard`, which is not
committed. With nothing set it builds on the built-in plain adapter; the reference look needs a local
checkout of its design system (`PXSIG_DS_SOURCE`); see
[packages/dashboard/README.md](packages/dashboard/README.md). Changes to the server, the data it
serves (`packages/pxsig/src/report.mjs`) and the API are testable without a build.

Views import components only from `@ui`, the UI contract (`packages/dashboard/src/ui/`). A new
contract component needs its section in `docs/ui/build-adapter.md`, an entry in the reference
adapter's `conformance.json` and a feature in `src/ui/features.ts` that renders it; a new feature
needs its entry in `features.ts`. The plain adapter (`src/ui/adapters/plain/`) and the example's
copy (`examples/custom-ui/pxsig-ui/`) stay identical but for their contract import;
`test/build-config.test.mjs` checks it.

Any change to the contract (a component, a prop, a token, an icon) also bumps `CONTRACT_VERSION`
in `contract.ts`, minor or major ([docs/ui/contract-changes.md](docs/ui/contract-changes.md) says
which), adds that version's section to `contract-changes.md`, keeps the reference adapter's
`conformance.json` `contract` at the new version, and records it with `node scripts/ui.mjs lock`.
`pnpm ui:check` fails until all four agree. Then:

```bash
pnpm ui:docs     # regenerate src/ui/manifest.json and docs/ui/features.md
pnpm ui:check    # what CI runs: no design-system import outside the adapters; code and docs agree
pnpm ui:gaps     # the conformance of the adapter a build would use (plain; hydrotik with PXSIG_DS_SOURCE)
pnpm typecheck   # tsc over the dashboard and every adapter; with PXSIG_DS_SOURCE, the reference adapter against the design system's sources too
```

The reference adapter is type-checked (and linted) in CI against
`adapters/hydrotik/design-system.d.ts`: the design system's own declarations for the names the
adapter imports, generated from a built checkout. After the adapter imports a new name, or the
design system changes, regenerate it with `PXSIG_DS_SOURCE=<checkout> pnpm ui:types` (`ui.mjs lock`
does too when PXSIG_DS_SOURCE is set); `pnpm typecheck` with PXSIG_DS_SOURCE fails while it is stale.

## Changelog fragments

A pull request that changes something a user can notice adds a fragment under `changelog.d/`
([changelog.d/README.md](changelog.d/README.md)) instead of editing `CHANGELOG.md`, which changes
only in a release. `node scripts/changelog.mjs check --since origin/main` fails a branch that
changes shipped code (`packages/*/src`, the addon's `.mjs`/`.cjs` files, `crates/*/src`) and adds
no fragment. A refactor or a test-only change that users cannot notice says so instead: put a line
`Changelog: none` in the body of one of the branch's commits.

## CI job names

The jobs in `.github/workflows/ci.yml` are required checks, matched by their exact names (with
their matrix legs: eleven in all). Renaming, adding or removing a job, or changing its `name:`,
leaves a required check waiting forever and blocks every pull request. New checks go in as steps
inside an existing job. Every third-party action is pinned by its full commit SHA, with a
`# vX.Y.Z` comment.

## Dependencies

Dependabot (`.github/dependabot.yml`) opens update pull requests every Monday for the GitHub
Actions, the pnpm workspace (grouped as `dev` and `prod`) and the Rust workspace. They go through
the same checks as any other pull request.

CI checks the dependencies against public advisory databases: `cargo deny --locked check`
(`deny.toml`: advisories, licences, sources) in the Rust job on Linux, and
`pnpm audit --prod --audit-level high` (only what ships to users) in the clean job. Both read the
database over the network, so a new advisory can fail a pull request that did not touch a
dependency. That is intended. The nightly benchmark workflow (`.github/workflows/bench.yml`) runs
`pnpm audit --prod --audit-level high` and `cargo deny --locked check advisories` too, so an
advisory published between pushes fails a nightly run. The fix is one of:

- **an update** of the affected dependency, in its own commit; or
- **an ignore entry with a reason and a date**: in `deny.toml` (`[advisories] ignore`, whose
  entries take a `reason`) for a crate, or in `pnpm.auditConfig.ignoreGhsas` in the root
  `package.json` for an npm package (JSON has no comments: the reason and the date go in the commit
  that adds it). The reason says why the advisory does not apply or what the fix is waiting on; the
  date says when to look again.

The root `package.json` carries `pnpm.overrides` for `vite` and `vite-node` (JSON has no comments,
so the reason is here). `@vanilla-extract/compiler` depends on its own `vite` and `vite-node`
(`^5 … ^8`, `^3.2.2 … ^6`); the overrides resolve both to the dashboard's Vite 8 line, so the
dashboard builds with one Vite. Dependabot skips Vite majors for the same reason
(`.github/dependabot.yml`): a new Vite major is taken by hand, overrides included.

Advisories for development tooling arrive as Dependabot pull requests instead of failing CI. A
licence outside `deny.toml`'s `allow` list fails; adding one is a decision for the owner.

## Pull requests

- One change per pull request, with a description of what changed and why.
- Tests for new behaviour and for bug fixes.
- `pnpm test`, `pnpm lint`, `pnpm lint:ratchet`, `node scripts/check-file-size.mjs --all`,
  `node scripts/check-clean.mjs` and
  `node scripts/changelog.mjs check --since origin/main` pass.
- Update the docs in `docs/` when a command, flag, config key, file format or default changes, and
  add a fragment in `changelog.d/` ([changelog.d/README.md](changelog.d/README.md)); `CHANGELOG.md`
  itself changes only in a release. A change to shipped code with no fragment fails CI unless a
  commit message body has the line `Changelog: none` (a refactor or a test, nothing a user notices).
- **Formats are contracts.** Spec v1 records, the `.psig` container, integrity status codes and
  exit codes change only with a version bump and a migration path. Status codes are only ever
  added, never renamed.
- **Safety rules are not negotiable.** Integrity repairs never write signatures and never approve.
  Writing baselines in bulk needs a person at a terminal. Agents cannot approve: no MCP tool
  approves, and bulk approval refuses under an assistant's marker. A change that weakens one of these will not be merged.

## Reporting issues

Use GitHub issues for bugs and ideas. For security problems, see [SECURITY.md](SECURITY.md).
