# Releasing

For maintainers. A release is a pushed tag `vX.Y.Z`. The `release` workflow
(`.github/workflows/release.yml`) builds the binary for every platform, collects the dashboard and
publishes to npm.

## Versions

Two files carry the version, and they must agree with the tag:

- `Cargo.toml`, `[workspace.package] version`. This is the source: both crates inherit it.
- `packages/pxsig/package.json`, `version`. Set it to the same value by hand.

Everything else reads one of these: the binary's `--version` and the engine daemon's `ping` come
from Cargo, the MCP server's `serverInfo.version` and the CLI from `packages/pxsig/package.json`. The
package's test suite (`test/features.test.mjs`) fails when the two files, or the built binary,
disagree.

The workflow's first job fails the release if the tag (without the `v`), the Cargo workspace version
and `packages/pxsig/package.json` differ. Bump both in one commit, then tag that commit:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

A tag with a prerelease suffix (`v0.2.0-dev.0`, `v0.2.0-rc.1`) publishes under the npm dist-tag
`next`. Any other tag publishes under `latest`.

## What the workflow does

1. **verify**: checks the versions as above.
2. **test**: `cargo test --workspace` on linux-x64.
3. **build**: `cargo build --release --locked --target <target> -p pxsig-cli` for each platform,
   uploaded as the artifact `pxsig-<platform>-<arch>`:

   | Package suffix | Runner             | Rust target                 |
   | -------------- | ------------------ | --------------------------- |
   | darwin-arm64   | `macos-14`         | `aarch64-apple-darwin`      |
   | darwin-x64     | `macos-14` (cross) | `x86_64-apple-darwin`       |
   | linux-x64      | `ubuntu-latest`    | `x86_64-unknown-linux-gnu`  |
   | linux-arm64    | `ubuntu-24.04-arm` | `aarch64-unknown-linux-gnu` |
   | win32-x64      | `windows-latest`   | `x86_64-pc-windows-msvc`    |

4. **dashboard**: produces `packages/pxsig/dist/dashboard/` (see below).
5. **publish**: generates the platform packages with `scripts/make-platform-packages.mjs` into
   `packages/cli-dist/` (git-ignored), publishes each one, adds them to `pxsig` as exact-version
   `optionalDependencies` (in the job's checkout only; nothing is committed), and publishes `pxsig`
   with the dashboard in `dist/`. A platform package already published at that version is skipped,
   so a failed run can be re-run.

`@pxsig/storybook-addon` is not part of this workflow; it is released separately.

Running the workflow by hand (`workflow_dispatch`) on a tag ref does the same. The `dry_run` input
runs every `npm publish` with `--dry-run`.

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
of these that is available, and fails with a message naming all three if none is:

1. **The `PXSIG_DS_SOURCE` secret.** A git URL, credentials included, of the design-system
   monorepo. The job clones it (optionally at the branch or tag in the `PXSIG_DS_REF` variable),
   installs its dependencies and runs `pnpm --filter @pxsig/dashboard build`.
2. **The `dashboard_artifact_url` input** of a manual run: a URL of a `pxsig-dashboard.tar.gz`.
3. **A release asset** named `pxsig-dashboard.tar.gz` on the GitHub release for the tag.

For 2 and 3, build the dashboard locally and pack it:

```bash
PXSIG_DS_SOURCE=<path to the design-system checkout> pnpm --filter @pxsig/dashboard build
COPYFILE_DISABLE=1 tar czf pxsig-dashboard.tar.gz -C packages/pxsig/dist dashboard
```

The tarball must contain only a top-level `dashboard/` folder with `index.html` in it; the job
rejects anything else. (`COPYFILE_DISABLE=1` keeps macOS `._*` files out.)

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
  every `@pxsig/cli-<platform>-<arch>`), open *Settings → Trusted Publisher* and add GitHub
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
