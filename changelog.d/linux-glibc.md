### Changed

- **The Linux platform packages declare `libc: ["glibc"]`.** `@pxsig/cli-linux-x64` and
  `@pxsig/cli-linux-arm64` hold glibc builds (`*-unknown-linux-gnu`), which do not run on a musl
  host such as Alpine. npm and pnpm now skip them there instead of installing a binary that fails
  to start, and pxsig reports the engine binary as missing. On a musl host, set `PXSIG_BIN` to a
  pxsig binary built for it, or run pxsig in the container image (Ubuntu, glibc).
