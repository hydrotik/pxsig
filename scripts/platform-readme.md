# {{name}}

The prebuilt engine binary of [pxsig](https://github.com/hydrotik/pxsig) for {{os}} on {{cpu}}:
`bin/{{exe}}`, built from the `pxsig-cli` Rust crate for the target `{{target}}`. pxsig's
signatures, comparisons and baselines are computed by this binary; the `pxsig` npm package is the
command line, the server and the MCP server that run it.

## Installation

This package is not meant to be installed directly. Install `pxsig`:

```bash
npm install -D pxsig
```

`pxsig` lists each platform package as an optional dependency, pinned to the exact version of
that `pxsig` release. This package's manifest sets `os: ["{{platform}}"]` and
`cpu: ["{{arch}}"]`, so npm, pnpm and Yarn install it only on a {{os}} {{arch}} host and skip it
everywhere else. The Linux packages also set `libc: ["glibc"]`.

The version of this package always equals the version of `pxsig` it belongs to: both are published
from the same release. An engine older than the command line (a binary left behind by an earlier
install, or an old `PXSIG_BIN`) is reported by `pxsig doctor` as `engine-old`, and the baselines it
writes carry no render environment.

## How pxsig finds the binary

The command line looks for the engine in this order:

1. `PXSIG_BIN`, when set: the path of a `pxsig` binary to use instead, for example a local
   `cargo build --release`;
2. `{{name}}/bin/{{exe}}`, resolved from the installed `pxsig` package (this package);
3. in a source checkout of pxsig, `target/release/{{exe}}`.

When neither of the first two is found in an installed `pxsig`, the error names the path where this
package's binary belongs. `npx pxsig config` prints the binary in use, and `npx pxsig doctor` names
it (`bundled ({{name}})` or `PXSIG_BIN (pxsig)`) in its setup preflight, before a project has a
manifest.

## Hosts without a package

- A musl Linux host (Alpine) installs no Linux package, since they are glibc builds. Build the
  engine from a clone with `cargo build --release` and set `PXSIG_BIN` to the result, or run pxsig in
  its container image (`ghcr.io/hydrotik/pxsig`).
- An install that leaves out optional dependencies (`npm install --omit=optional`,
  `pnpm install --no-optional`) has no engine either: install again with them.
- Other operating systems and CPUs have no prebuilt binary. CI tests macOS, Linux and Windows
  only; elsewhere a build from source with `PXSIG_BIN` is untested.

## Contents

- `bin/{{exe}}`: the engine binary.
- `index.js` and `index.cjs`: the binary's absolute path, for other tools. The package is an ES
  module: `import bin from '{{name}}'` loads `index.js`, `require('{{name}}')` loads `index.cjs`,
  and `{{name}}/bin/{{exe}}` resolves to the binary itself.
- `test/binary.test.js`: `node --test` in this folder runs the binary once (`--version`), checks
  its output, and checks that `import`, `require` and the `bin/{{exe}}` path give the same file.
- `LICENSE`: the {{license}} licence.
- `package.json`: the manifest, with no `bin` entry (pxsig runs the binary by its path).

The package has no dependencies and no install scripts: the binary is in the tarball, and nothing
is downloaded at install time.

## Verifying the binary

The package is published from GitHub Actions with npm provenance (trusted publishing), and every
release file has a GitHub build provenance attestation. The binary in this package is byte for
byte the release's `{{asset}}` file, so one checksum and one attestation cover both. The
binaries are not code-signed.

In a POSIX shell, from the project that installed pxsig:

```bash
npm audit signatures    # npm's registry signatures and provenance for every installed package
gh attestation verify "$(node -p "require('{{name}}')")" --repo hydrotik/pxsig
```

With pnpm, which does not hoist the package, run the second command in `node_modules/pxsig`.

`SHA256SUMS` on the [GitHub release](https://github.com/hydrotik/pxsig/releases/tag/v{{version}})
lists the checksum of every file.
[Verifying a release](https://github.com/hydrotik/pxsig/blob/v{{version}}/docs/releasing.md#verifying-a-release)
has the full steps.

## Documentation

- [pxsig](https://github.com/hydrotik/pxsig/blob/v{{version}}/README.md): what pxsig does and how to start.
- [The npm package](https://github.com/hydrotik/pxsig/blob/v{{version}}/docs/package.md): what `pxsig` installs and exports.
- [Platforms](https://github.com/hydrotik/pxsig/blob/v{{version}}/docs/platforms.md): what differs between macOS, Linux and Windows, and every program pxsig starts.
- [The engine binary](https://github.com/hydrotik/pxsig/blob/v{{version}}/docs/cli.md#the-engine-binary): its commands, flags and exit codes.
- [Security](https://github.com/hydrotik/pxsig/blob/v{{version}}/SECURITY.md): reporting a vulnerability.
- [Issues](https://github.com/hydrotik/pxsig/issues)

{{license}}. Source: https://github.com/hydrotik/pxsig
