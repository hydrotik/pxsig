### Behaviour changes

- **A dashboard build names the source it came from.** The stamp a build writes (`BUILD.json` for
  the reference build, `pxsig-build.json` for `pxsig dashboard build`) records `commit`, the full
  sha of pxsig's own git checkout, `dirty`, whether that checkout had uncommitted changes under
  the paths that feed the build, and `changes`, a sha256 of those changes. A build from an
  installed pxsig, or outside a git checkout, records all three as null: it is the release its
  `pxsig` version names. No path, user name or host is recorded. `pxsig-build.json` also records
  the adapter's name (`adapterName`), and its `adapter` is now the adapter's file relative to the
  project root (a built-in adapter by name), never an absolute path; `pxsig dashboard check` reads
  either form.
  Run from a git checkout of pxsig, `pxsig serve` passes over a `PXSIG_DASHBOARD_DIR` or
  `dashboard.ui` build when the paths that feed the build differ between its commit and the
  checkout's, or its uncommitted changes (by fingerprint) are not the checkout's, with the same
  note as for a build from another version, and says so for a prebuilt dashboard that is out of
  date that way (`pnpm build:dashboard`), which it still serves. `pxsig doctor` reports both as
  `dashboard-stale` ([integrity.md](../docs/integrity.md#setup-problems)). A commit that changes
  none of those paths leaves a build current. A build with no commit is compared by version only,
  as before.
  To update: run `pxsig dashboard build` once more for a custom dashboard (a project's `dashboard.ui`, or a `PXSIG_DASHBOARD_DIR` build) to record the new fields; nothing to do otherwise.

### Added

- **The dashboard shows which build it is.** On hover of "pxsig" in the top bar, after the
  versions, and as the last line of Help: the short commit, "modified" and the changes' short
  fingerprint for a build with uncommitted changes, so two modified builds of one commit differ (or "release build" with no commit), the design system's commit, the
  adapter and the build time in UTC; the pxsig version it was built for when it is not the
  server's. `GET /__pxsig/data` carries the same fields as `build`
  ([server.md](../docs/server.md)), with no path.
