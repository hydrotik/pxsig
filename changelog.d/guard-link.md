### Behaviour changes

- **The dashboard decides through the dashboard link, and no token is in any page.** The server
  put a token into the dashboard page whenever a request looked like a browser loading it, so a
  script sending two headers could read it and approve. Now `pxsig serve`, started by a person at a
  terminal, prints a one-time link (`…/report/#ticket=…`, two minutes, single use; macOS opens it);
  the page trades it for a cookie scripts cannot read, and approve, reject and accept carry that.
  Reading, checks, repairs and bookmarks work as before; the first decision in a tab without the
  link says how to get it. `pxsig serve --link` prints a new link. This supersedes the Unreleased
  "Security" entry's "one in the dashboard page when a browser loads it": reconcile it at release.
- **The Storybook panel decides through a small window.** Its frame is on another site, where the
  cookie is not sent: approve, reject and accept open a small window of the pxsig server for a
  moment, which records the decision and closes.
- **No personal data in new log lines.** Approval, repair and accessibility-decision lines no longer
  carry `by` (the git email, else the OS user name); the commit and the pull request say who.
  `approvals.identity: "git-email"` keeps the old field. Old lines are unchanged and still read.

### Added

- **Every new log line names the pxsig that wrote it** (`pxsig: "<version>"`). `approve verify`
  marks drifted baselines last logged by an older pxsig (a teammate who has not upgraded).
- **`requires` in `pxsig.workspace.json`**: a version range; a pxsig outside it refuses to run there,
  and `doctor` warns about installs outside it (`version-required`). pxsig 0.3.x does not read it.
- **`approvals.level`**: `standard` (the default); `strict` is reserved and refused for now.
- **Dashboard pages carry a Content-Security-Policy** (scripts and data from the server only) and
  every response `X-Content-Type-Options: nosniff`.
- **CI runs the published pxsig 0.3.2 against a store this version wrote** (`scripts/compat-old.mjs`):
  it reads the new lines and the store, and ignores `requires`.
