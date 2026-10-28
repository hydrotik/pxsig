### Behaviour changes

- **`pxsig stale` fails when too many files were edited to trace.** Above the number of edited
  files it traces one by one, it used to print "Every result is newer than the edits that can
  change it." and exit 0. It now says how many source files were edited since the oldest verdict,
  names `pxsig check --all`, and exits 1 (`advisoryExit` on warn), as for stale verdicts.
- **`pxsig list` and `pxsig a11y` refuse a flag given without its value.** A bare `--component`,
  `--mode` or `--state` used to stop with "toLowerCase is not a function" or match nothing. It now
  exits 2 with "usage: --component needs a value" (naming the flag).

### Fixed

- **`pxsig approve apply` refuses a plan with an entry the manifest no longer has.** It used to
  stop with "Cannot read properties of undefined". It now refuses the whole plan before writing
  anything: "<n> planned entries are no longer in the manifest: <ids>: plan again" (exit 2).
- **A project folder in `pxsig.workspace.json` that is not a string** is a setup error naming the
  file and the project, instead of Node's "The "paths[1]" argument must be of type string".
- **A command whose lock file became unreadable** says "lock taken over by an unreadable lock file
  (<path>)" instead of "`pxsig undefined` (pid undefined, since undefined)".
- **`GET /__pxsig/integrity?project=<p>&story=<id>`** answers with the project asked about when
  two projects share the story, not the first of them.
- **`pxsig serve`: a check queued while the manifest became unreadable** reports "the manifest did
  not load — <why>" instead of "Storybook is not reachable".
- **A Storybook index whose `entries` is null** is reported as a broken index instead of throwing.
- **`pxsig serve`: an engine reply with neither a result nor an error** fails that request instead
  of an uncaught exception.
- **`pxsig help approvals.identity` and `pxsig help approvals.level`** print their pages instead of
  "entry.values.join is not a function".
- **`pxsig help check ''`** prints the `check` page; an empty subcommand word is ignored.
- **`pxsig entry <id>`** shows the review decision (approved, rejected) instead of always `none`.
- **`pxsig affected`** notes the remote URLs it does not follow when a changed file imports one.
- **The MCP server answers a line that is not a JSON-RPC object** (`null`, a number, a string, an
  array) with the Invalid Request error (-32600) and keeps serving; `null` used to stop it.
