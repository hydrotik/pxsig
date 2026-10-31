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
it, then tag that commit on `main`:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

A tag with a prerelease suffix (`v0.2.0-dev.0`, `v0.2.0-rc.1`) publishes under the npm dist-tag
`next`. Any other tag publishes under `latest`.

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
PXSIG_DS_SOURCE=<design-system checkout> pnpm build:dashboard   # the release's dashboard
node scripts/showcase-shots.mjs                                  # docs/product-shots/*.png + shots.json
```

The script serves that build with mock data (a design system in the middle of a review), shoots the
Overview and the review's first change in the light theme, crops them and records the version in
`docs/product-shots/shots.json`. Review the images in the branch's diff like any other change.
The workflow's verify job runs `node scripts/check-shots.mjs --tag vX.Y.0` and fails the release
when the shots are from another minor. A patch or a prerelease keeps the last shots.
`node scripts/showcase-shots.mjs --serve` keeps the mock dashboard running for shots by hand.

## What the workflow does

1. **verify**: checks the versions as above. On a tag (not a dry run) it also checks that the
   tagged commit is on `main` and that every required check passed on it (the 11 jobs of `ci.yml`,
   listed once in `scripts/required-checks.mjs`, whose test compares the list with `ci.yml`).
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

The CLI finds it in `rustBinary()` (`packages/pxsig/src/lib/workspace.mjs`): `PXSIG_BIN` if set,
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
   monorepo. The job fetches the commit named by the `PXSIG_DS_REF` variable, which must be a
   full 40-character commit SHA (the job fails on a branch, a tag or an empty value), installs its
   dependencies and runs `pnpm --filter @pxsig/dashboard build` with `PXSIG_UI_ADAPTER=hydrotik`
   and `PXSIG_DS_SOURCE` set. The adapter is named rather than left to the default, which without
   `PXSIG_DS_SOURCE` is the plain adapter.
2. **A release asset** named `pxsig-dashboard.tar.gz` on the GitHub release for the tag.

There is no input that fetches a dashboard from any other URL. The job writes which source it used,
and for a release asset its sha256, to the run's summary; the copy that ships is in the release's
`SHA256SUMS` and has its own attestation. A dashboard built by the secret is attested as built by
this workflow; a release asset was built on a maintainer's machine, and its attestation records only
that this workflow packed it.

For 2, build the dashboard locally and pack it:

```bash
PXSIG_UI_ADAPTER=hydrotik PXSIG_DS_SOURCE=<path to the design-system checkout> \
  pnpm --filter @pxsig/dashboard build
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
commit (with the secret, `PXSIG_DS_REF`), or the release fails; a checkout with changes is a
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
tag, which starts the workflow:

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
