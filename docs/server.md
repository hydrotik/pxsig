# Server and dashboard

```bash
pxsig serve [--port 6070] [--watch] [--no-open] [--tab stories] [--project a,b] [--workspace dir] [--debug]
```

One server per workspace. It serves the dashboard and an HTTP API for every project, keeps one
engine process for renders and decisions (and a second one for tracing edits) and one pool of
warm browsers, and keeps each project's integrity ledger current.
Approving a baseline or re-checking a story then costs one render.

| Flag                       | Meaning                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--port <n>`               | First port to try (default: `server.port` in the workspace file, else 6070). If it is taken, the next ten are tried.                                                                                                                                    |
| `--watch`                  | When a file under a project's `srcRoot` changes, re-check only the entries it traces to. A file it cannot trace (an unimported `.json`) is printed, not a reason to re-check everything ([ci.md](ci.md#how-selection-decides)).                         |
| `--no-open`                | Do not open a browser tab. On Windows none is opened anyway: the link is printed.                                                                                                                                                                       |
| `--link [--open] [--copy]` | Print a new dashboard link from the running server and exit (a person at a terminal only, see [Guards](#guards)); with `--open`, also open it in the default browser (macOS and Linux); with `--copy`, also copy it to the clipboard (macOS and Linux). |
| `--tab <name>`             | Open the dashboard on this section.                                                                                                                                                                                                                     |
| `--project <a,b>`          | Serve only these projects.                                                                                                                                                                                                                              |
| `--workspace <dir>`        | The workspace root, instead of walking up from the current folder.                                                                                                                                                                                      |
| `--debug`                  | Print every program the server starts, with its arguments, on stderr (see [platforms.md](platforms.md#programs-pxsig-starts)).                                                                                                                          |

The server binds to `127.0.0.1` only: it is each developer's own, never deployed
([team.md](team.md)). On start it writes
`<workspace>/node_modules/.cache/pxsig/server.json` (`url`, `pid`, `startedAt`, `projects`), so the
CLI, the MCP server and the Storybook addon find it on whatever port it got. It removes the file
on exit. A second server started beside a running one (another port) leaves the file naming the
running server.

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
writes with 409 until it has the lock. Until then it writes nothing into that store: its
integrity ledger stays in memory (served by `GET /__pxsig/integrity`) and its run manifest goes to
a temp folder. `GET /__pxsig/projects` shows each project's `locked` state.

**Built Storybook.** When a project's `storybook.url` does not answer and its
`storybook.staticDir` holds a Storybook build, the server serves that folder on a free 127.0.0.1
port and renders against it (its origin is allowed like a Storybook's).

## Dashboard

`http://127.0.0.1:6070/report/` (the root redirects there).

| Section        | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview       | The latest check's counts and duration across the top. Below, on the left: open items (changed, new, rejected, render errors, components with coverage errors, new a11y violations, flaky), each linking to its list or starting a review, then stale entries by component as a heatmap (the 12 highest shares; a tile opens Coverage on that component). On the right: an errors card while there are render or coverage errors (each row opens where it is fixed, with the safe repair), then changed entries per run. One column on a narrow page. "Changed" counts changes still waiting for a decision.                                                            |
| Review Stories | Every entry, filterable and grouped by component, with the inspector: baseline, current render and diff side by side or overlaid, metrics, gate reasons, change regions; **Originals** (`O`) shows the two images with nothing drawn on them. `A` approves, `R` rejects, one entry at a time; with `approvals.byStory` on, **Approve story** approves every mode and state of the story that waits for a decision, in one batch; **Re-check** queues the entry again. A card with a render error, or a NEW entry not rendered yet, has its own **Re-check**. "Review N changes" starts a session over the changed (or new) entries with progress and a closing summary. |
| Coverage       | The integrity ledger: components and entries by status, with the safe repairs, and stale entries by component as a heatmap (a tile filters the table to that component and opens its entries)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

A banner above every section (on the Overview, the errors card instead, while there are errors)
shows coverage errors, entries that need a first approval (counted on their own, with the queue
that approves them), orphaned baselines (with the command that moves
them aside), and **Run safe repairs** while there is something to repair. A check that is running
is shown, and one that failed (Storybook down, a broken index) shows its error until dismissed.
| Accessibility | axe violations per entry and per rule, new ones first |
| Runs | The last check's timing, past runs, and which entries changed in each |
| Diagnostics | Scenarios, calibration and benchmark results. Shown only when a report for them exists in the store; pxsig 0.2 does not produce those reports. |
| Help | The gate as configured, what each status means, keyboard shortcuts, commands |

The top bar links each section by its id in the URL hash: `overview`, `stories`, `integrity`,
`a11y`, `history`, `diagnostics` and `help`; the older `#scenarios`, `#calibration` and
`#performance` open Diagnostics.

With several projects, a switcher in the top bar picks one. A `/report/` that names no project
opens on the first project in `pxsig.workspace.json`'s `projects` and adds `?project=<name>` to its
URL, so a reload or a shared link keeps it; the API itself never picks one (below). URL
parameters:

| Parameter             | Meaning                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `?project=<name>`     | The project to show                                              |
| `#inspect=<id>`       | Open the inspector on an entry                                   |
| `?embed=1&story=<id>` | The inspector alone, for one story (used by the Storybook panel) |

The dashboard ships prebuilt in the `pxsig` npm package. In a clone without a build, the API works
and `/report/` answers 404 with "the dashboard is not built (<folder>)", the folder relative to
the workspace, else `~/…` under the home folder.

A project can rebuild the dashboard on its own design system (`dashboard.ui`, `pxsig dashboard
build`: [ui/build-adapter.md](ui/build-adapter.md)). The server then serves that build while it is
current (newer than the adapter's files, same pxsig version); otherwise it serves the prebuilt one
and prints the command that rebuilds it. `PXSIG_DASHBOARD_DIR` names a dashboard folder outright.

## HTTP API

GET requests take `?project=<name>`; POST requests take a `project` field in the JSON body. Either
may be left out when the workspace has one project, or when the entry id or story id belongs to
exactly one project.

### Reading

| Request                                                           | Response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /__pxsig/projects`                                           | `{ workspaceId, projects: [{ name, label, root, storybook, entries, integrity, error, locked }] }`: the workspace by its id (as in `/status`), each project's `root` relative to the workspace. No absolute path: it would name the user                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `GET /__pxsig/status`                                             | `workspaceId` (below), whether a check or repair is running, queue length, review decisions (without a rejection's reason: Storybook's origins read this answer), per-story status and per-story integrity across all projects, integrity summaries, the dashboard URL, and `approving`: `allowed` (whether this browser opened the dashboard link; never the session itself), `folder` (the workspace folder's own name, never a path) and `command` (how a person gets a new link there: the project's pxsig through its package manager, else `pxsig` from the PATH). No answer the dashboard reads carries an absolute path                                                                                                                                                                                                                                                            |
| `GET /__pxsig/data?project=`                                      | One project's dashboard data: the last check, history, review decisions (with a rejection's reason, `note`), the open rejections (`rejections`: `visual` and `a11y`, by entry id, each with `prompt`, the paragraph for an assistant the dashboard's Copy for an agent copies; below), `settings` (`rejections.note.ask`: whether Reject asks for a reason), integrity, image paths (`paths.rejected`: the rejection packets), and `react`: the React analysis' `status` (`compiler`: `ready`, `off`, `not-installed`, `bad-config`, `running`, `skipped` or `failed`; `renders`; `off`: where and which key turned it off; `missing` packages; `configWarning`; `error`; `held`: who holds the store when a run could not save; `stale`: source files changed since), the last `report` (`reports/react.json`, or a run kept in memory) and its `source` (`check`, `server`, `react-cli`) |
| `GET /__pxsig/integrity?project=`                                 | The project's ledger. `&story=<id>` for one story, `&component=` / `&status=` to filter, `&fresh=1` to recompute first. `/api/integrity` is the same.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET /__pxsig/gate-report?project=&id=&full=1&keepId=1&noImage=1` | The gate report of one entry, for an issue on hydrotik/pxsig ([gate-issues.md](gate-issues.md)): `{ text, url, trimmed, facts, image }`, `image` a PNG data URL (baseline, render and diff side by side; null with `noImage`). The story id is `entry-1` unless `keepId`; no path or user name. Writes nothing. 409 when there is nothing to report (no check, no baseline, a render error).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /__pxsig/events`                                             | Server-sent events: `hello`, `data` (a report changed), `review` (a decision: `id`, `entry` or `a11y`; with `row` and `summary` when check.json was rewritten, `refetch` when more changed), `rejection` (an open rejection changed: `id`, `kind`, `record`, null once it closed), `check` (`running`, with `renders: true` for Measure renders; `progress` `{ done, total }`, at most four a second; `done`; `cancelled` `{ ids, done, total }`; `error`), `react` (`running` `{ trigger, files: { done, total }, cached }`, `done` `{ summary, ms }`, `skipped`, `error` `{ error }`), `integrity`, `watch`                                                                                                                                                                                                                                                                              |

`workspaceId` names the workspace the server serves: the first 16 hex characters of the SHA-256 of
its real path, so the path itself is not sent. Every port tries 6070 first, so a client can reach
another workspace's server there. The CLI, the MCP server and the Storybook addon compare the id
with their own workspace's and use only a server that matches: a server that names another
workspace counts as not running, and one that names none (pxsig 0.6 or earlier) is used only at an
address found for this workspace (`server.json`, the addon's `server` option). The CLI's message
says which server answered and why it was passed over. With `PXSIG_URL`, a mismatch is a warning
line and the server is used.

### Files

| Request                                             | Response                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /p/<project>/renders/latest/<id>.png`          | The latest render                                                                                                                                                   |
| `GET /p/<project>/renders/base/<id>.png`            | The baseline image, read out of the `.psig`                                                                                                                         |
| `GET /p/<project>/diffs/latest/<file>`              | Diff images                                                                                                                                                         |
| `GET /p/<project>/sig/<id>`                         | The `.psig` header, as JSON                                                                                                                                         |
| `GET /p/<project>/reports/rejected/<folder>/<file>` | A rejection packet's files (below). To the server's own origin only: a request another origin or site makes is refused (403), and the answer carries no CORS header |

### Writing

| Request                                                    | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /__pxsig/approve {id, batch?, reason?, kind?}`       | The latest render becomes the baseline: a `.psig` with the render as its image. The old baseline is snapshotted to `<store>/history/<batch>/`, the write logged in `approvals.ndjson` (without `reason`: it is kept beside the line's `ref` in `<store>/reports/decisions.ndjson`, only when `reports/` is git-ignored), and the a11y baseline follows the render. A NEW entry (no baseline yet) gets its first baseline, logged with `before: null`. A `batch` is kept only in pxsig's own shape (`BATCH_RE`: `pxsig approve apply` sends one per plan); any other, or none, gets the server's (`<time>-<via>`). The answer's `entry.batch` is the one logged. 409 when there is no latest render, or when the server does not hold the project's store lock. |
| `POST /__pxsig/approve-story {story, reason?}`             | Approves every entry of the story that waits for a decision (each mode and state), as one batch: the dashboard's **Approve story**, a person's click. Refused (403) unless the project sets `approvals.byStory: true` ([configuration](configuration.md#keys)). Entries that pass, did not render, were rejected or are already approved are left out; the answer lists `approved`, `skipped` (with why) and the `batch`. Each approval is logged and undone like a single one.                                                                                                                                                                                                                                                                                |
| `POST /__pxsig/reject {id, note?}`                         | Records a rejection for the current result. `note`, the reason, is optional: one line of plain text, at most 280 characters (control characters and line breaks become spaces; nothing left is no reason). It opens the entry's rejection, which outlives the decision (below); a reject on an entry already rejected adds a new reason. While the store's `reports/` is not git-ignored the rejection opens with no note: the answer carries `notice` (`Note not kept: <store>/reports/ is not git-ignored. pxsig doctor shows the fix.`) and the decision `noteKept: false`.                                                                                                                                                                                 |
| `POST /__pxsig/a11y-accept {id}`                           | Puts the entry's current axe violations on its accepted list (`<store>/a11y.json`), logged in `<store>/a11y-decisions.ndjson`. 409 when the last check has no axe results for it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /__pxsig/a11y-reject {id, note?}`                    | Marks the entry's violations for a fix, with an optional reason as `reject`; the accepted list is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /__pxsig/a11y-unaccept {id, rule?}`                  | Takes `rule` (or every rule) off the entry's accepted list and marks its row's violations new in `check.json` at once; logged. 409 when the rule is not on the list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `POST /__pxsig/a11y-prune {plan, batch, reason?}`          | `pxsig a11y --prune` after the person typed the phrase: takes the plan's rules off the accepted lists, logs one `action: "prune"` line per entry, updates the report rows, and tells the dashboard. A `batch` not in pxsig's own shape is replaced by the server's (`<time>-prune`); the answer's `batch` is the one logged. The CLI's token only. 409 when `a11y.json` changed since the plan was made; 400 for a malformed plan.                                                                                                                                                                                                                                                                                                                             |
| `POST /__pxsig/a11y-unreview {id}`                         | Clears the accessibility decision and closes its open rejection; after an accept it restores the previous accepted list (logged). Accessibility decisions live in `reports/a11y-review.json` and, like visual ones, end at the entry's next check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `POST /__pxsig/unreview {id}`                              | Clears the decision and closes the entry's open rejection. For an approval it also restores the previous baseline from that approval's snapshot (a first baseline moves to trash/) and its a11y baseline, logged as an undo; 409 when the baseline changed since.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /__pxsig/check {ids? \| story? \| stories? \| all?}` | Queues renders and engine checks; answers 202 with the queued ids. Results merge into `check.json`, and its `generatedAt` moves (`fullCheckAt` keeps when every entry was last checked together). A name the manifest does not have is registered first when Storybook is healthy (no signature: NEW, logged in `repairs.ndjson`); the answer lists those entries in `registered`, and each name that could not be registered in `skipped` with why. Without a project, the check is split across the projects that own the ids.                                                                                                                                                                                                                               |
| `POST /__pxsig/check {ids, renders: true}`                 | Measure renders: the same check, counting React renders in that run, also with `react.renders` off (never when React is off). Needs the dashboard link (below). The rows rendered carry `renders` with `at` (when) and `prev` (the counts of the row they replaced).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `POST /__pxsig/check/cancel {project}`                     | Stops the running check: the entries rendered by then are checked and recorded, the others keep their last results; the `check` event is `cancelled`. Needs the dashboard link; 409 when no check is running.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST /__pxsig/gate-report/self-check {id}`                | Report to pxsig's self-check: a dry re-render. The entry is rendered into a temporary folder and judged against its baseline as a check judges it, but nothing in the store changes: not its render, not `check.json` or the history, and never a review decision. Answers `state`: `differs` (still fails the gate, with `reasons`), `passes`, `error` or `not-checked` (with `error`, no path). Decides nothing: no dashboard link needed.                                                                                                                                                                                                                                                                                                                   |
| `POST /__pxsig/react/analyse {project}`                    | Runs the React Compiler analysis now (compared with `main`; no browser; writes only `reports/react.json`, and only as the store lock's holder). Needs the dashboard link; answers 202; 409 when React or the compiler analysis is off, the packages are not installed or a value is bad. The server also runs it after its startup integrity pass and, with `--watch`, after a code edit.                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /__pxsig/react/skip {project}`                       | Stops the running analysis; nothing is written. Needs the dashboard link.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /__pxsig/rejection-dismiss {id, kind}`               | Closes the entry's open rejection (`kind`: `visual` or `a11y`) after a re-check, with no decision: the reason no longer applies. A person's only (the MCP's token is refused). 404 when none is open; 409 while the entry is still rejected (undo that instead).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST /__pxsig/repair {apply?, only?, stale?}`             | The safe repairs: the plan, or with `apply: true` the result. Never prunes. `stale: true` also re-checks stale verdicts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

A new verdict for an entry clears its review decision. A rejection's reason stays: the entry's
**open rejection** (`<store>/reports/rejections.json`, `visual` and `a11y` by entry id: when it
opened, the reasons, newest first, and the checks since) lasts until the entry passes a check (or,
for accessibility, has no new violations), a person approves it or accepts its violations, the
rejection is undone (`unreview`), a person dismisses the reason (`rejection-dismiss`), or the entry
leaves the manifest. While it is open it has a **rejection packet**, `<store>/reports/rejected/<id>/`
(`<id>.a11y/` for accessibility; [configuration.md](configuration.md#rejections)): written after
the reject's answer, refreshed after each check of the entry, removed when the rejection closes and,
for any left over, at the server's start. When it is written, a `rejection` event carries the
record with `packet` (store-relative); while `reports/` is not git-ignored none is, and the record's
`packetError` says why. `<store>/reports/rejections.ndjson` logs each event (`rejected`, `note`,
`checked`, `closed` with how). Both files are in the store's git-ignored `reports/`: the reason is
never committed. A note is kept only when git leaves `reports/` out (asked only for a reject with
a note, never blocking); otherwise the rejection opens all the same with `note: null`. Each decision also carries an opaque reference (`ref`: random, with no time, host,
user or entry in it), kept in the decision files and in `approvals.ndjson` and
`a11y-decisions.ndjson` lines; nothing sends it anywhere. Those two logs are committed and carry no
reason: a `reason` sent with `approve`, `approve-story`, `a11y-accept` or `a11y-prune` (one line,
at most 500 characters) goes to `<store>/reports/decisions.ndjson`, one line per `ref`, and only
when the store's `reports/` is git-ignored; otherwise it is not kept and the decision goes through
all the same. The server asks git only for a decision with a reason (the dashboard sends none), and
never blocks on it. An undo through `unreview` logs `undo: { in: "dashboard", from: "snapshot" }`.

A new verdict for an entry clears its review decision. An approval marks the entry's row in
`check.json` (`approved: { at, batch }`) until then, so `summary.failed` leaves it out; an undo
clears the mark. `summary.changed` counts only real changes waiting for a decision. Ids must match the entry id pattern in
[spec.md](spec.md#entry-id); others get 400.

### Guards

- **Decisions need a person.** `approve`, `approve-story`, `reject`, `unreview`, the `a11y-*`
  routes (`a11y-prune` included) and `rejection-dismiss` need the dashboard link (in a browser) or one of the server's file
  tokens (`pxsig approve apply` and `pxsig a11y --prune`, the MCP), or they are refused (403, "approving needs a person: use the dashboard or
  `pxsig approve` in a terminal"; a browser without the link gets "approving here needs the
  dashboard link", `code: "needs-dashboard-link"`).
- **The runs a person starts from the dashboard need the link too.** React's Analyse and Skip,
  Measure renders (`check` with `renders: true`) and Cancel (`check/cancel`) decide nothing, but
  they replace results or stop work a person started: without the link's cookie they are refused
  (403, "this needs the dashboard link", `code: "needs-dashboard-link"`). A plain `check` is
  unchanged.
- **The dashboard link.** `pxsig serve` prints `<url>/report/#ticket=<t>` when a person started it
  at a terminal (no assistant's marker, not in the background; [agents.md](agents.md#markers)), and on macOS opens it; `pxsig serve
  --link`, run by a person at a terminal, prints a new one from the running server (`--link --open`
  also opens it, as the start does; `--link --copy` also copies it to the clipboard and says so). The
  copy is opt-in: any program on the computer, an assistant included, can read the clipboard, while
  the printed link reaches only the person at the terminal; the ticket works once and expires, so
  what the clipboard holds stops working soon. The ticket is single use, with 5 minutes to access it;
  there is no limit on deciding after that. The page trades it at `POST /__pxsig/session` (its own
  origin only) for a cookie `pxsig_link_<port>` that scripts cannot read and other sites cannot send
  (`HttpOnly; SameSite=Strict`), valid until the server stops, and takes it out of the address bar.
  No token is ever in a page: a script fetching the page, with any headers, gets nothing to decide
  with. Reading, checks and repairs need no link, so bookmarks work as before; only the first
  approve, reject or accept in a tab without the link shows how to get it. The Storybook panel is a
  frame on another site, where the cookie is not sent: its decisions go through a small window of
  the server's own (`/report/?decide=1`), which posts the decision with the cookie and closes.
- **File tokens.** The server makes two at random each time it starts. The CLI's goes into `node_modules/.cache/pxsig/serve-<port>.token`
  (mode 0600, removed on exit; on Windows into the user's own
  `%LOCALAPPDATA%\pxsig\tokens\<workspace>\`, see [platforms.md](platforms.md#what-pxsig-keeps-on-this-machine)), which `pxsig approve apply` reads after its person-at-a-terminal
  check. The MCP's goes into `serve-<port>.mcp.token` (also 0600) and is accepted only on `reject`,
  `unreview`, `a11y-reject` and `a11y-unreview`, and its unreview of an approval, an accept or a
  rejection a person made (or gave a reason for) is refused (403): an agent may ask for attention,
  add its own reason (kept as `via: mcp`, an assistant's) and clear its own rejections, never
  accept, undo a person's acceptance or clear a person's rejection. A
  request carrying a file token with browser headers (`Origin`, `Sec-Fetch-Site`) is refused. An
  agent posting to the server with `curl` or `fetch` has none of them. The token decides `via` in
  `approvals.ndjson`, `a11y-decisions.ndjson` and on rejections in `review.json` /
  `a11y-review.json` (`dashboard` for the link, `cli` or `mcp`); a `via` in the body is ignored. `check` and `repair` need no token: the CLI,
  the MCP and the Storybook addon use them, and neither one approves.
- **Origin.** A POST with an `Origin` header is refused (403) unless it is the server's own origin
  or, for `check` and `repair` only, the origin of a served project's Storybook (with `localhost`
  and `127.0.0.1` both accepted). A POST whose `Sec-Fetch-Site` is not `same-origin` is refused on
  the same terms. CORS headers are sent only to those Storybook origins, and never allow
  `x-pxsig-token`. The dashboard page may be framed only by the server and those Storybooks
  (`Content-Security-Policy: frame-ancestors`).
- **Host.** Any request whose `Host` is not `127.0.0.1`, `localhost` or `[::1]` on the server's
  port is refused (403), so a page that rebinds its own name to 127.0.0.1 gets nothing.
- **Page headers.** Dashboard pages carry a `Content-Security-Policy` (scripts, data and fonts
  from the server only, `object-src 'none'`, `frame-ancestors` as above) and every response
  `X-Content-Type-Options: nosniff`.
- **What this is not.** The link and the tokens are a guard, not authentication: a process running
  as you can read the token file. They stop an agent or a script from approving by posting to the
  server or reading the page, and a web page from posting to it at all; who approved what is in the
  log and in the pull request that commits it.
- **Storybook health.** Before rendering, a check fetches Storybook's index. When it is unreachable
  or broken, nothing is rendered or recorded, and the `check` event carries a setup error (the
  dashboard shows it). When three or more renders, and at least half, hit Storybook's error page,
  the run is dropped the same way; one or two such renders (a story checked alone that throws)
  are recorded as render errors.

## Static report

```bash
pxsig report [--project ui] [--out dir]
```

Writes one project's dashboard into a folder that opens from disk (default
`<store>/reports/site/`): the app, the data inlined, latest renders, diffs, and the baseline
images taken out of the `.psig` files. Review actions are not available in a static report, and it
carries no rejection reasons (they belong to the live session). Use it as a CI artifact.
