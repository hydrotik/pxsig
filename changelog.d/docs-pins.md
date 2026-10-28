### Documentation

- **Which browser renders.** `docs/platforms.md` and `pxsig help platforms` now say what pxsig
  has always done: when Playwright's Chromium is missing, it launches the installed Google Chrome,
  then Microsoft Edge, and the channel is part of the render environment. A test ties both pages
  to the code's list.
- **Troubleshooting.** `docs/troubleshooting.md` and a new `pxsig help troubleshooting` topic: one
  entry per error pxsig prints (Storybook not reachable, no manifest, no Chromium, a different
  Storybook on the port, a locked store, `needs-dashboard-link`, a program blocked by policy, a
  JSON file with a byte order mark), each with its cause and fix. A test checks that every quoted
  error text is in the code.
- **Architecture.** `docs/architecture.md` lists the modules added since 0.4: the render
  environment, warn mode, SARIF, the browser container, `pxsig dashboard check`, the addon's
  snapshot view and the JSDoc types.
- **Contributing.** `CONTRIBUTING.md` covers installing Playwright's Chromium (the tests that
  render skip without it), running each suite, changelog fragments and `Changelog: none`, why CI
  job names never change, and how a dependency advisory is handled. The repository pins Node.js
  in `.nvmrc` and declares `rust-version` in `Cargo.toml`; `pnpm test` at the root runs every
  suite.
