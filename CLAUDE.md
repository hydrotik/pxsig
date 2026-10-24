# pxsig — agent notes

This is a public repository. What must never be committed is in CONTRIBUTING.md ("What never goes
into this repository"); CI checks files and paths, and only the maintainer's machine has the list
of names that must not appear.

- **Reading another repository** (a peer design system, a consuming app, a sibling checkout): use
  the `peer-reader` agent, which reports in neutral terms. Do not copy names, identifiers, paths or
  code from it.
- **After any such work**, and before pushing that branch or opening its pull request, run
  `/scrub` (or `node scripts/check-clean.mjs --require-terms --since origin/main`, with
  `--text <pr-body.md>` for the PR body).
- Private notes go in `.local/` (git-ignored).
