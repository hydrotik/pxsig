# Server and dashboard

```bash
pxsig serve [--port 6070] [--watch] [--no-open] [--tab stories] [--project a,b] [--workspace dir]
```

One server per workspace. It serves the dashboard and an HTTP API for every project, keeps one
engine process and one pool of warm browsers, and keeps each project's integrity ledger current.
Approving a baseline or re-checking a story then costs one render.

| Flag | Meaning |
| --- | --- |
| `--port <n>` | First port to try (default: `server.port` in the workspace file, else 6070). If it is taken, the next ten are tried. |
| `--watch` | When a file under a project's `srcRoot` changes, re-check only the entries it affects. |
| `--no-open` | Do not open a browser tab. |
| `--tab <name>` | Open the dashboard on this tab. |
| `--project <a,b>` | Serve only these projects. |
| `--workspace <dir>` | The workspace root, instead of walking up from the current folder. |

The server binds to `127.0.0.1` only. On start it writes
`<workspace>/node_modules/.cache/pxsig/server.json` (`url`, `pid`, `startedAt`, `projects`), so the
CLI, the MCP server and the Storybook addon find it on whatever port it got. It removes the file
on exit.

Each project needs a manifest. A project whose manifest is missing or unreadable is still listed,
with the error, and has no entries.

The flags of [configuration.md](configuration.md#layers) (`--storybook-url`, `--storybook-static`,
`--grid`, …) apply to every project the server opens.

**One writer per store.** The server takes each served project's store lock
(`<store>/reports/.lock`, with its pid, start time and URL) and holds it until it stops; every
write for that project (approve, reject, re-check, repair) runs in the server's queue. A CLI
`check --full` against a served project hands its selection to that queue; `doctor --repair --apply`
asks for `POST /__pxsig/repair`. When another process (a full check, a migration) holds a
project's lock at start, the server logs who, keeps trying every 2 s, and answers that project's
writes with 409 until it has the lock. `GET /__pxsig/projects` shows each project's `locked` state.

**Built Storybook.** When a project's `storybook.url` does not answer and its
`storybook.staticDir` holds a Storybook build, the server serves that folder on a free 127.0.0.1
port and renders against it (its origin is allowed like a Storybook's).

## Dashboard

`http://127.0.0.1:6070/report/` (the root redirects there).

| Tab | Content |
| --- | --- |
| Overview | The latest check's counts and duration, then open items (changed, new, rejected, render errors, coverage errors, new a11y violations, flaky), each linking to its list or starting a review |
| Review | Every entry, filterable and grouped by component, with the inspector: baseline, current render and diff side by side or overlaid, metrics, gate reasons, change regions. `A` approves, `R` rejects. "Review N changes" starts a session over the changed (or new) entries with progress and a closing summary. |
| Coverage | The integrity ledger: components and entries by status, with the safe repairs |
| Accessibility | axe violations per entry and per rule, new ones first |
| Runs | The last check's timing, past runs, and which entries changed in each |
| Diagnostics | Scenarios, calibration and benchmark results. Shown only when a report for them exists in the store; pxsig 0.2 does not produce those reports. |
| Help | The gate as configured, what each status means, keyboard shortcuts, commands |

The tab ids in the URL hash are `overview`, `stories`, `integrity`, `a11y`, `history`,
`diagnostics` and `help`; the older `#scenarios`, `#calibration` and `#performance` open Diagnostics.

With several projects, a switcher in the header picks one. URL parameters:

| Parameter | Meaning |
| --- | --- |
| `?project=<name>` | The project to show |
| `#inspect=<id>` | Open the inspector on an entry |
| `?embed=1&story=<id>` | The inspector alone, for one story (used by the Storybook panel) |

The dashboard ships prebuilt in the `pxsig` npm package. In a clone without a build, the API works
and `/report/` answers 404 with "the dashboard is not built".

## HTTP API

GET requests take `?project=<name>`; POST requests take a `project` field in the JSON body. Either
may be left out when the workspace has one project, or when the entry id or story id belongs to
exactly one project.

### Reading

| Request | Response |
| --- | --- |
| `GET /__pxsig/projects` | `{ workspace, projects: [{ name, root, storybook, entries, integrity, error }] }` |
| `GET /__pxsig/status` | Whether a check or repair is running, queue length, review decisions, per-story status and per-story integrity across all projects, integrity summaries, the dashboard URL |
| `GET /__pxsig/data?project=` | One project's dashboard data: the last check, history, review decisions, integrity, image paths |
| `GET /__pxsig/integrity?project=` | The project's ledger. `&story=<id>` for one story, `&component=` / `&status=` to filter, `&fresh=1` to recompute first. `/api/integrity` is the same. |
| `GET /__pxsig/events` | Server-sent events: `hello`, `data` (a report changed), `review`, `check` (`running`, `done`, `error`), `integrity`, `watch` |

### Files

| Request | Response |
| --- | --- |
| `GET /p/<project>/renders/latest/<id>.png` | The latest render |
| `GET /p/<project>/renders/base/<id>.png` | The baseline image, read out of the `.psig` |
| `GET /p/<project>/diffs/latest/<file>` | Diff images |
| `GET /p/<project>/sig/<id>` | The `.psig` header, as JSON |

### Writing

| Request | Effect |
| --- | --- |
| `POST /__pxsig/approve {id, batch?, via?, reason?, kind?}` | The latest render becomes the baseline: a `.psig` with the render as its image. The old baseline is snapshotted to `<store>/history/<batch>/`, the write logged in `approvals.ndjson`, and the a11y baseline follows the render. A NEW entry (no baseline yet) gets its first baseline, logged with `before: null`. 409 when there is no latest render, or when the server does not hold the project's store lock. |
| `POST /__pxsig/reject {id}` | Records a rejection for the current result. |
| `POST /__pxsig/a11y-accept {id}` | Puts the entry's current axe violations on its accepted list (`<store>/a11y.json`), logged in `<store>/a11y-decisions.ndjson`. 409 when the last check has no axe results for it. |
| `POST /__pxsig/a11y-reject {id}` | Marks the entry's violations for a fix; the accepted list is unchanged. |
| `POST /__pxsig/a11y-unreview {id}` | Clears the accessibility decision; after an accept it restores the previous accepted list (logged). Accessibility decisions live in `reports/a11y-review.json` and, like visual ones, end at the entry's next check. |
| `POST /__pxsig/unreview {id}` | Clears the decision. For an approval it also restores the previous baseline from that approval's snapshot (a first baseline moves to trash/) and its a11y baseline, logged as an undo; 409 when the baseline changed since. |
| `POST /__pxsig/check {ids? \| story? \| stories? \| all?}` | Queues renders and engine checks; answers 202 with the queued ids. Results merge into `check.json`. Without a project, the check is split across the projects that own the ids. |
| `POST /__pxsig/repair {apply?, only?}` | The safe repairs: the plan, or with `apply: true` the result. Never prunes. |

A new verdict for an entry clears its review decision. Ids must match the entry id pattern in
[spec.md](spec.md#entry-id); others get 400.

### Guards

- **Origin.** A POST with an `Origin` header is refused (403) unless it is the server's own origin
  or the origin of a served project's Storybook (with `localhost` and `127.0.0.1` both accepted).
  CORS headers are sent only to those Storybook origins.
- **Storybook health.** Before rendering, a check fetches Storybook's index. When it is unreachable
  or broken, nothing is rendered or recorded, and the `check` event carries a setup error. When
  most renders hit Storybook's error page, the run is dropped the same way.

## Static report

```bash
pxsig report [--project ui] [--out dir]
```

Writes one project's dashboard into a folder that opens from disk (default
`<store>/reports/site/`): the app, the data inlined, latest renders, diffs, and the baseline
images taken out of the `.psig` files. Review actions are not available in a static report. Use it
as a CI artifact.
