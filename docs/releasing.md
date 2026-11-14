# Releasing

For maintainers. A release is a pushed tag `vX.Y.Z`. The `release` workflow
(`.github/workflows/release.yml`) builds the binary for every platform, collects the dashboard, packs
every package, attests and checksums what it packed, attaches it to the GitHub release and publishes
to npm.

## Versions

Every released version must agree with the tag:

- `Cargo.toml`, `[workspace.package] version`. This is the source: both crates inherit it, and
  `Cargo.lock` records it for each (`cargo build` updates the lock).
- `packages/pxsig/package.json`, `packages/storybook-addon/package.json` and
  `packages/dashboard/package.json`, `version`. Set each to the same value by hand.

Everything else reads one of these: the binary's `--version` and the engine daemon's `ping` come
from Cargo, the MCP server's `serverInfo.version` and the CLI from `packages/pxsig/package.json`. The
package's test suite (`test/features.test.mjs`) fails when the two files, or the built binary,
disagree.

`node scripts/check-versions.mjs` checks that they all agree (CI runs it on every pull request, so a
missed bump shows before the tag), and the workflow's first job runs it with `--tag`, failing the
release if the tag (without the `v`) differs from any of them. Bump them all in one commit, merge
it, then tag the merge commit on `main`, but only once `main`'s `ci.yml` run on that merge commit
has finished green. The same first job refuses a tagged commit whose 11 required checks have not
all passed, and a check still running counts as not passed: a tag pushed while the run is in
progress fails the release (0.7.4's first release run failed this way). Watch the run with
`gh run list -w ci.yml -c <merge-commit-sha>`, then tag:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

A tag with a prerelease suffix (`v0.2.0-dev.0`, `v0.2.0-rc.1`) publishes under the npm dist-tag
`next`. Any other tag publishes under `latest`.

## Gate noise, before a release that changes the gate

A release that changes the gate's defaults (a rule, a threshold, the color rule's values) changes
every project's verdicts, and the evidence for the defaults must cover more than one machine.
Before tagging it, run the **gate noise** workflow (`.github/workflows/gate-noise.yml`, Actions →
gate noise → Run workflow, on the release commit; `gpu-runner` names a runner with a GPU when the
account has one). On Linux, macOS and Windows, two jobs each render examples/single-package and
the dashboard's fixture screens (plain adapter) twice; one job compares them with the commit's
engine: run to run on one machine, and machine to machine on one OS, with today's rules, the color
rule alone and the whole gate ([tools/README.md](../tools/README.md#gate-noise)). Every failure
there is a false positive. The tables are on the run's summary page and the numbers in its
`gate-noise-report` artifact; a default ships when every scenario has none, and the margins (the
closest flat area and cell change) are far enough from the rule. It is a measurement, never a
required check, and it also runs once on a pull request that edits the workflow.

## The changelog

Pull requests add fragments to `changelog.d/` ([changelog.d/README.md](../changelog.d/README.md))
and never edit `CHANGELOG.md`; CI fails a pull request that does, unless its branch is
`release/…`. Before tagging, on a `release/X.Y.Z` branch:

```bash
node scripts/changelog.mjs preview              # what the release section will hold
node scripts/changelog.mjs release X.Y.Z        # merge Unreleased and every fragment; delete them
```

Then write the release's summary paragraph under its new heading, set the versions (above), re-shoot
the product shots for a minor or major release (below), commit
the latest nightly `bench-results` as `scripts/bench/baseline.json` ([benchmark.md](benchmark.md#refreshing-the-baseline)), and
merge the branch before pushing the tag. `release` keeps the headings in a fixed order (Breaking
changes, then Behaviour changes), with the entries already under Unreleased ahead of the fragments.

**Upgrading.** Every entry under Breaking changes and Behaviour changes carries a `To update:` line:
what a consumer does about it, or "nothing to do" and why (`changelog.mjs check` fails a fragment
without one). `release` opens the version's section with **Upgrading from <previous version>**,
which collects those lines (the ones with nothing to do in one line at the end), and the GitHub
release's notes point at that section. Before tagging, add the same steps, grouped by who acts, as
an "Upgrading to X.Y" section of [migrating.md](migrating.md).

## Product shots

A minor or major release (`X.Y.0`) ships new README screenshots of its own dashboard. On the release
branch, after setting the versions:

```bash
pnpm build:dashboard              # the release's dashboard: the pinned design system
node scripts/showcase-shots.mjs   # docs/product-shots/*.png + shots.json
```

The script serves that build with mock data (a design system in the middle of a review), shoots the
Overview and the review's first change in the light theme, crops them and records the version in
`docs/product-shots/shots.json`. Review the images in the branch's diff like any other change.
The workflow's verify job runs `node scripts/check-shots.mjs --tag vX.Y.0` and fails the release
when the shots are from another minor. A patch or a prerelease keeps the last shots.
`node scripts/showcase-shots.mjs --serve` keeps the mock dashboard running for shots by hand.

## pxsig's own baselines

The dashboard's own screens have baselines in pxsig, beside them: `packages/dashboard/.pxsig/`, the
store of the `pxsig` project (`packages/dashboard/pxsig.config.json`). Each screen `pxsig dashboard
check` renders, in each theme, is one entry, `<section>--<feature>-<n>@<theme>`
(`inspector--header-1@dark`). They capture the reference build, rendered in pxsig's container, the
image pinned by digest in `docker/screens-image.json`, whose fonts and browser stay fixed:

```bash
pnpm build:dashboard                      # hydrotik, at the commit design-system.json pins
pnpm screens:check [--only <feature,…>]   # exit 1: a screen changed, is new or did not render
```

`pnpm screens:check` runs `scripts/screens-check.mjs` in that image (Docker, with the checkout
mounted and `pnpm install` done). It writes the store as `pxsig check` does and writes no baseline.
`node scripts/screens-check.mjs` alone renders outside the container: its fonts differ, and its
rows say so.

**Locked structure.** The same run checks each screen's structure: its accessibility snapshot
(roles, names, states and order) against `packages/dashboard/fixtures/locked/<section>/<name>-<n>.aria.yml`,
one file per screen, which both themes must match (the theme toggle's name aside). A difference
fails the check like a changed screen. For a change made on purpose, `pnpm screens:check
--update-locks` rewrites the files, and the diff of that commit is the review; every run also
writes the current snapshots to the store's `reports/structure/`.

**Locked geometry.** A feature may name anchors in `src/ui/features.ts` (`anchors`: the inspector's
Reject, Approve and Close, the top bar, the review filters, the inspector toolbar's controls, the
side panel). Each anchor must sit in the same place and size on every screen of its feature where
it shows, and its box is committed in `packages/dashboard/fixtures/locked/geometry.json`, so a
change that moves it everywhere at once fails as well. `--update-locks` rewrites it too. Boxes
depend on fonts: take them from the container (`pnpm screens:check`, or CI's `reports/structure/`).

**No findings.** Every screen must also have no accessibility (axe) or layout finding, as `pxsig
dashboard check --strict` requires; the run lists each one.

**Rendered twice.** Every fixture screen renders twice in the same run
(`scripts/lib/screens-repeat.mjs`): the same build, container and browser binary, but pass 2 in a
browser launched for it (no cache, GPU or font state shared with pass 1, which could make two
renders agree that a fresh run would not), with its own scenario servers and the features in
reverse order (other neighbours in the parallel renders). The two renders must have the same pixels
(decoded, exactly), the same accessibility snapshot and the same anchor boxes. A screen whose
renders differ is **unstable**: the run names it with what differed (the pixel count and their
region, whether the difference is within the gate, the first structure line that differs), keeps
both renders in `reports/fixture-repeat/` (with `unstable.json` and `summary.md`, which CI adds to
the job summary) and fails like a changed screen, so a screen that wobbles is caught in the run
that renders it, not later as a spurious change against its baseline. A difference within the gate
fails too: the gate hides it from one check, not from the next. (The wobbles it first found were
Chromium's partial raster, which pxsig now turns off for every capture: `--disable-partial-raster`,
docs/configuration.md, "Text rendering".) The one exception is
`packages/dashboard/fixtures/unstable.json`, a committed list of entry ids, each with its reason; it
starts empty, a screen goes on it only by the owner's decision, and comes off once its fix (in the
design system's component, or a capture wait) lands. An entry naming no screen fails; one whose
screen rendered the same twice is noted for removal. Pass 2 adds the fixture render time once more
(about a minute in CI); `--repeat 1` renders once, for a quick local look.

**Live screens.** The fixture screens answer the dashboard from sample data; the live screens run
the real `pxsig serve`, the CLI a person runs, on a staged copy of `examples/single-package`, and
drive it through the reviewer's flows on one page: open the dashboard link, approve the new
entries, reject one and undo it, re-check one, `pxsig check --full` from a terminal beside the
server, a real source change (two entries change, the inspector on real renders), the React
analysis (a component the React Compiler now skips, found by Analyse; Measure renders; a
measurement cancelled part way), a browser without the link (Read only), the server stopped
(Offline). Each step is one screen in each theme,
`live--<flow>-<n>@<theme>` (`live--approve-2@dark`), with its locked structure in
`fixtures/locked/live/`, checked with the fixture screens in the same run and reviewed the same way.
A behaviour-free change to the server or the dashboard shows `0 to review`: that is its proof.
This commit's engine makes every screen's verdict and runs the live screens: the screens and
release workflows build it for Linux and pass it to the container (`PXSIG_LIVE_BIN`, a path inside
the checkout), so a change to the gate or the engine shows in pxsig's own screens too; the browser
and fonts stay the image's. The image's own engine predates the color rule (0.7.7), so without
`PXSIG_LIVE_BIN` the check refuses its verdicts (exit 2). A macOS build cannot run in the container;
locally, build a Linux one first:

```sh
docker run --rm -v "$PWD:$PWD" -w "$PWD" rust:1.99 cargo build --release --locked --target-dir target/linux
PXSIG_LIVE_BIN="$PWD/target/linux/release/pxsig" pnpm screens:check
```

- The flows are `scripts/live/flows.mjs`. An id is a baseline: a step is never renumbered; a new
  step takes the next number or a new flow. `scripts/live-screens.test.mjs` fails when the
  dashboard calls a server route that no flow covers and `UNCOVERED` does not list with its reason;
  that list may only shrink.
- `pnpm screens:check` stages the example on the host first (`scripts/live/stage.mjs`: installed
  from its lockfile, its Storybook built as committed and with the scripted change, under
  `target/pxsig-live`; skipped while nothing it reads changed). In the container each
  run starts from a clean scratch store there: 9 entries pass, 3 are new.
  The staged example also has the React Compiler and Babel (pxsig's own test fixtures,
  `packages/pxsig/test/react-compiler`, installed and linked in) and a git repository whose `main`
  is the example as committed: the base the analysis compares with.
- What varies from run to run (the times the server writes, durations, its ports, the staged base's
  commit) is rewritten at the HTTP boundary (`scripts/live/volatile.mjs`), strictly: a listed field
  that goes missing, or a time, port, duration or commit no rule rewrites, fails the step and names
  the field. The base's commit is a hash of the example's files, so a dependency bump to an example
  (Dependabot) changes no live screen.
- Approvals in the flows are clicks on the page of the server the run started, in its scratch
  store, with a link minted from that server's own CLI token. Nothing in `packages/dashboard/.pxsig`
  is approved by a run; ports 6006 and 6070 are never used.
- `--repeat <n>` (default 2) runs the flows n times per theme (and, above 1, renders the fixture
  screens twice, "Rendered twice"): a step whose structure differs
  between runs, or whose screenshot differs beyond the gate (run 2 against run 1, as a render
  against its baseline), fails as "not deterministic". Any difference, within the gate too, keeps
  both renders in `reports/live-repeat/` and is logged.
  `--no-live` leaves the live screens out; `--only` takes live features (`live.approve`) too.

**Where it runs.** The `screens` workflow (`.github/workflows/screens.yml`) builds the dashboard on
the design system at the commit `design-system.json` pins (fetched with the `PXSIG_DS_SOURCE`
secret by `scripts/ds-fetch.mjs`, as `pnpm ds:fetch` does in a worktree) and checks it on every pull request and push to `main`; a pull request
without the secret (a fork, Dependabot) is not checked. The release's Dashboard job checks the
dashboard it ships, built or attached, the same way (its fixture screens, `--no-live` for now) and
stops the release on any difference.

**Review.** A failing run uploads its renders as the `pxsig-screens` artifact. Download it into the
store, then review and approve in the dashboard:

```bash
gh run download <run id> -R hydrotik/pxsig -n pxsig-screens -D packages/dashboard/.pxsig
cd packages/dashboard && node ../pxsig/bin/pxsig.mjs serve   # approving needs serve --link
```

The approved `.psig` files and `approvals.ndjson` go into the same pull request. The store commits
only `manifest.json`, `approvals.ndjson` and `baselines/<section>/<id>.psig` (`.gitignore`,
`scripts/check-clean.mjs`). A new image changes `docker/screens-image.json` in a pull request that
re-approves the screens it moves.

## What the workflow does

1. **verify**: checks the versions as above. On a tag (not a dry run) it also checks that the
   tagged commit is on `main` and that every required check passed on it (the 11 jobs of `ci.yml`,
   listed once in `scripts/required-checks.mjs`, whose test compares the list with `ci.yml`). It
   reads each check's latest run once and does not wait: a check queued or in progress fails it.
2. **test**: `cargo test --workspace` on linux-x64.
3. **build**: `cargo build --release --locked --target <target> -p pxsig-cli` for each platform,
   uploaded as the artifact `pxsig-<platform>-<arch>`:

   | Package suffix | Runner                 | Rust target                 |
   | -------------- | ---------------------- | --------------------------- |
   | darwin-arm64   | `macos-latest`         | `aarch64-apple-darwin`      |
   | darwin-x64     | `macos-latest` (cross) | `x86_64-apple-darwin`       |
   | linux-x64      | `ubuntu-latest`        | `x86_64-unknown-linux-gnu`  |
   | linux-arm64    | `ubuntu-24.04-arm`     | `aarch64-unknown-linux-gnu` |
   | win32-x64      | `windows-latest`       | `x86_64-pc-windows-msvc`    |

4. **dashboard**: produces `packages/pxsig/dist/dashboard/` (see below).
5. **sbom-rust**: a CycloneDX SBOM of the engine's crates (`cargo-cyclonedx`, pinned, from
   `Cargo.lock`): `pxsig-engine.cdx.json`.
6. **pack**: generates the platform packages with `scripts/make-platform-packages.mjs` into
   `packages/cli-dist/` (git-ignored), adds them to `pxsig` as exact-version `optionalDependencies`
   (in the job's checkout only; nothing is committed), runs pxsig's prepack step
   (`scripts/sync-dashboard-source.mjs`), removes `scripts` and `devDependencies` from the
   published manifests and pins each README's links to the tag (`blob/main` and links out of the
   package become `blob/v<version>`; `scripts/pack-manifest.mjs`), and runs `npm pack --ignore-scripts` on every
   package: `pxsig` (with the dashboard in `dist/`), each `@pxsig/cli-<platform>-<arch>` and
   `@pxsig/storybook-addon`. A packed manifest that still has either key, or a packed `.md` file that links to `main` or to a file the tarball does not hold, fails the job. It also writes `pxsig-dashboard.tar.gz`, the npm SBOM
   (`pxsig-npm.cdx.json`: the packed `pxsig` installed into an empty project and read by
   `@cyclonedx/cyclonedx-npm`, pinned, plus the packages the dashboard bundle inlines), checks it
   and the engine SBOM for known advisories of any severity (osv-scanner, pinned, its download
   checked against its sha256: a finding fails the job), the raw binaries `pxsig-<platform>-<arch>[.exe]`, and
   `SHA256SUMS` over all of them (`scripts/release-files.mjs`). Beside it, the **dashboard-drift**
   job lists the dashboard screens that look different from the last release's
   (`scripts/dashboard-drift.mjs`, see [The dashboard](#the-dashboard)). Advisory, read-only, and
   in its own job, so the install it needs never runs where the release files are made.
7. **attest**: a provenance attestation for every one of those files
   (`actions/attest-build-provenance`), then attaches them all to the GitHub release for the tag,
   creating the release if it does not exist yet. Skipped in a dry run.
8. **publish**: publishes the packed tarballs, platform packages first, then `pxsig`, then the
   addon, so npm serves exactly the files that were checksummed and attested. Any package already
   published at that version is skipped, so a failed run can be re-run, and a dry run of a released
   version checks the build without failing.

Every action in the workflows is pinned to a full commit sha (the version is in a comment beside
it), and the npm used to pack and publish is an exact version. Updating one is an ordinary pull
request that changes the sha and the comment together.

Running the workflow by hand (`workflow_dispatch`) on a tag ref does the same. The `dry_run` input
runs every `npm publish` with `--dry-run` and skips the attestations and the GitHub release. A dry
run may also run on a branch: with no tag to compare,
verify only checks that `Cargo.toml` and `packages/pxsig/package.json` agree, and when no dashboard
source is available the dashboard job packs a placeholder `index.html` (with a warning) instead of
failing:

```bash
gh workflow run release.yml --ref main -f dry_run=true
```

## Platform packages

Each binary ships in its own package, `@pxsig/cli-<platform>-<arch>`, with `os` and `cpu` set so a
package manager installs only the one that matches the host. The binary is at
`bin/pxsig` (`bin/pxsig.exe` on Windows).

The CLI finds it in `rustBinary()` (`packages/pxsig/src/lib/workspace/peers.mjs`): `PXSIG_BIN` if set,
otherwise `@pxsig/cli-${process.platform}-${process.arch}/bin/<exe>` resolved from the `pxsig`
package, otherwise `target/release/` of a source checkout. Package names and paths in
`scripts/make-platform-packages.mjs` must stay in step with that function.

To try the script locally, point it at a folder laid out like the downloaded artifacts:

```bash
node scripts/make-platform-packages.mjs --version 0.2.0 --artifacts <dir> --out packages/cli-dist \
  --only darwin-arm64 --dry-run
```

`<dir>/pxsig-<platform>-<arch>/pxsig[.exe]` is the expected layout. `--allow-missing` skips
platforms without a binary; `--write-optional-deps <package.json>` sets the version and the
`optionalDependencies` in that file.

## The dashboard

The dashboard compiles against a design system that is not public (see
`packages/dashboard/README.md`), so CI cannot always build it. The dashboard job takes the first
of these that is available, and fails with a message naming both if neither is:

1. **The `PXSIG_DS_SOURCE` secret.** A git URL, credentials included, of the design-system
   monorepo. The job runs `node scripts/ds-fetch.mjs` with it, which fetches the commit pinned in
   `design-system.json` (a full 40-character lower-case commit SHA; it fails on anything else)
   into the runner's temp folder (`PXSIG_DS_DIR`, outside anything cached) and installs its
   dependencies, never printing the source or leaving it in a file; then
   `pnpm --filter @pxsig/dashboard build`, whose default in this repository is `hydrotik` on that
   checkout. The pin is bumped by a reviewed commit (CONTRIBUTING.md, "The design system"), so a
   worktree and CI build the same design system.
2. **A release asset** named `pxsig-dashboard.tar.gz` on the GitHub release for the tag.

There is no input that fetches a dashboard from any other URL. The job writes which source it used,
and for a release asset its sha256, to the run's summary; the copy that ships is in the release's
`SHA256SUMS` and has its own attestation. A dashboard built by the secret is attested as built by
this workflow; a release asset was built on a maintainer's machine, and its attestation records only
that this workflow packed it.

For 2, build the dashboard locally and pack it:

```bash
pnpm build:dashboard   # the pinned design system (git config pxsig.dsSource, CONTRIBUTING.md)
COPYFILE_DISABLE=1 tar czf pxsig-dashboard.tar.gz -C packages/pxsig/dist dashboard
```

The build is unminified unless `PXSIG_DASHBOARD_MINIFY=1` is set; a release ships it unminified so
reviewers can read what runs (packages/dashboard/README.md).

Every build writes `dashboard/BUILD.json` (`scripts/build-record.mjs`), which ships in the
package: the adapter, the design-system commit with whether its checkout had changes and its
`pnpm-lock.yaml` sha256, this repository's lockfile sha256, the Node version, the build time
(`SOURCE_DATE_EPOCH` when set) and the third-party packages compiled into the bundle with their
versions and licences. Either way the job checks it (`scripts/check-dashboard-build.mjs`): it must
exist, name the `hydrotik` adapter, list the bundled packages and record a full design-system
commit, the one `design-system.json` pins (a release asset too), or the release fails; a checkout with changes is a
warning. A release asset built with pxsig 0.6.0 or earlier has no `BUILD.json`: rebuild it. The pack job then appends those packages to `pxsig-npm.cdx.json`
as bundled components (`scripts/bundle-sbom.mjs`, read from the module paths the unminified
bundle keeps), so the npm SBOM covers the dashboard too.

The tarball must contain only a top-level `dashboard/` folder with `index.html` in it; the job
rejects anything else. (`COPYFILE_DISABLE=1` keeps macOS `._*` files out.)

**Drift since the last release.** The dashboard-drift job downloads `pxsig-dashboard.tar.gz` from the most
recent earlier release that has one, renders it and this release's dashboard with this checkout's
`pxsig dashboard check` on the same runner, and compares each screen with the engine
(`dashboard check --compare`). The changed, new and gone screens go to the run's summary, and the
gallery (with the earlier screenshot and the changed pixels beside each changed screen) is the
`dashboard-drift` artifact. It never fails the release: a dashboard change is often intended; the
list is for the release notes and for review. A placeholder dashboard (a dry run without a source)
is not compared.

Attach it before the workflow runs. Creating the release with the asset also creates and pushes the
tag, which starts the workflow, so run it only once `main`'s `ci.yml` run on the merge commit has
finished green ([Versions](#versions)):

```bash
gh release create v0.2.0 pxsig-dashboard.tar.gz --target main --title v0.2.0 --notes-file <notes>
```

If the tag is already pushed and the dashboard job failed, upload the asset and re-run the failed
jobs:

```bash
gh release upload v0.2.0 pxsig-dashboard.tar.gz
```

## npm credentials and provenance

Releases publish with **npm trusted publishing**: the publish job's GitHub OIDC identity is
exchanged for a short-lived token, so no npm token is stored. Every package gets provenance.

- **Trusted publishers.** On npmjs.com, for each package (`pxsig`, `@pxsig/storybook-addon` and
  every `@pxsig/cli-<platform>-<arch>`), open _Settings → Trusted Publisher_ and add GitHub
  Actions with repository `hydrotik/pxsig`, workflow `release.yml` and environment `npm`.
- **`npm` environment.** The publish job runs in it. Add required reviewers to hold each release
  for approval before anything is published.
- **The first publish of a new package.** A trusted publisher can only be set on a package that
  exists. For a release that creates packages (the first one, or a new platform), put a granular
  `NPM_TOKEN` secret (publish rights to `pxsig` and `@pxsig`) in the `npm` environment; the job uses
  it when present and warns. Afterwards, add the trusted publishers and **delete the secret**.
- **Requirements.** npm 11.5.1 or later (the job installs it) and `id-token: write` (set on the job).
  npm checks that each package's `repository` matches the GitHub repository the workflow runs in;
  the platform packages take it from `Cargo.toml`.

## Verifying a release

Each GitHub release from 0.4.0 on holds the npm tarballs, the raw binaries, the dashboard, two
CycloneDX SBOMs and `SHA256SUMS`, and every file has a provenance attestation: GitHub's signed record
of the workflow run and commit that built it. The binaries are not code-signed.

Checksums, for files downloaded from the release page (`sha256sum -c` on Linux):

```bash
gh release download v0.4.0 --repo hydrotik/pxsig --dir pxsig-v0.4.0
cd pxsig-v0.4.0 && shasum -a 256 -c SHA256SUMS
```

Provenance, for any of those files, or for what npm installed (the binary inside
`@pxsig/cli-<platform>-<arch>` is byte for byte the release's `pxsig-<platform>-<arch>`):

```bash
gh attestation verify pxsig-v0.4.0/pxsig-0.4.0.tgz --repo hydrotik/pxsig
gh attestation verify node_modules/@pxsig/cli-darwin-arm64/bin/pxsig --repo hydrotik/pxsig
npm audit signatures   # npm's own provenance for every installed package
```
