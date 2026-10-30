### Behaviour changes

- **The peer ranges start at the versions CI tests: `playwright >=1.58` (was `>=1.40`) and, for
  `@pxsig/storybook-addon`, `storybook >=10` (was `>=9`).** Playwright 1.58.2 is the oldest
  version CI runs pxsig with (the container image), and the examples test Storybook 10 only.
  Nothing changes at run time: pxsig does not check either version. A project that pins an older
  version sees the install report a peer conflict: pnpm and Yarn warn; npm 7 and later stops with
  `ERESOLVE` unless run with `--legacy-peer-deps`. Update Playwright to 1.58 or later and
  Storybook to 10, or keep the older version and accept the warning (`--legacy-peer-deps` on
  npm); older versions are untested.
