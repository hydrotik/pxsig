# Contributing

Thank you for helping. This file covers setting up, testing and what a pull request needs.

## Setup

You need:

- Node.js 20 or later
- pnpm 10 (the version is pinned in `package.json`; `corepack enable` picks it up)
- Rust stable, with cargo

```bash
git clone https://github.com/hydrotik/pxsig
cd pxsig
pnpm install
cargo build --release          # target/release/pxsig, which the CLI finds in a source checkout
```

Run the CLI from the clone:

```bash
node packages/pxsig/bin/pxsig.mjs --help
```

To try a change against a real project, link the package into that project
(`pnpm add -D link:<path-to-clone>/packages/pxsig`) and set `PXSIG_BIN` to the clone's
`target/release/pxsig`.

## Tests

```bash
cargo test                     # the engine and the binary
pnpm -r test                   # every package (node --test)
pnpm test                      # both
node scripts/check-clean.mjs   # what must never be committed (below)
```

The Node tests build their fixtures (stories, manifests, PNGs) in temporary folders. Add tests the
same way: synthesise what you need in code.

## What never goes into this repository

This repository holds source, schemas, tests and documentation. `scripts/check-clean.mjs` fails
the build when a tracked file breaks one of these rules, and CI runs it on every push and pull
request:

- **No images, fonts or binaries.** No `.png`, `.jpg`, `.woff2`, `.wasm` and the like.
- **No baselines or run output.** No `.psig`, `.pxsig.json`, stores (`.pxsig/`, `__pxsig__/`),
  renders, diffs, reports, `target/` or `dist/`. Those belong to the projects under test.
- **No absolute home-directory paths.**
- **No names from other repositories or organisations.** The script also checks a denylist of
  names. The list is never committed or uploaded anywhere, because that would publish the names:
  it lives in a git-ignored `.clean-terms` file at the repository root (one name per line, `#`
  for comments) on the maintainer's machine. CI does not check names.

Enable the pre-push hook once per clone; it runs the check, denylist included, before every push
and refuses the push on any problem (or when `.clean-terms` is missing):

```bash
git config core.hooksPath .githooks
```

Run `node scripts/check-clean.mjs` by hand any time. With `--all` it checks every file on disk,
not only tracked ones.

In examples and docs use neutral names: `packages/ui`, `apps/storybook`, `my-design-system`.

## The dashboard

The dashboard is built from `packages/dashboard` into `packages/pxsig/dist/dashboard`, which is not
committed. Building it needs a local checkout of its design system; see
[packages/dashboard/README.md](packages/dashboard/README.md). Changes to the server, the data it
serves (`packages/pxsig/src/report.mjs`) and the API are testable without a build.

Views import components only from `@ui`, the UI contract (`packages/dashboard/src/ui/`). A new
contract component needs its section in `docs/ui/build-adapter.md`, an entry in the reference
adapter's `conformance.json` and a feature in `src/ui/features.ts` that renders it; a new feature
needs its entry in `features.ts`. Then:

```bash
pnpm ui:docs     # regenerate src/ui/manifest.json and docs/ui/features.md
pnpm ui:check    # what CI runs: no design-system import outside the adapters; code and docs agree
pnpm ui:gaps     # the reference adapter's conformance
```

## Pull requests

- One change per pull request, with a description of what changed and why.
- Tests for new behaviour and for bug fixes.
- `cargo test`, `pnpm -r test` and `node scripts/check-clean.mjs` pass.
- Update the docs in `docs/` when a command, flag, config key, file format or default changes, and
  add a line to `CHANGELOG.md` under "Unreleased".
- **Formats are contracts.** Spec v1 records, the `.psig` container, integrity status codes and
  exit codes change only with a version bump and a migration path. Status codes are only ever
  added, never renamed.
- **Safety rules are not negotiable.** Integrity repairs never write signatures and never approve.
  Writing baselines in bulk needs a person at a terminal. Agents cannot approve without an explicit
  instruction. A change that weakens one of these will not be merged.

## Reporting issues

Use GitHub issues for bugs and ideas. For security problems, see [SECURITY.md](SECURITY.md).
