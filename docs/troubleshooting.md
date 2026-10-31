# Troubleshooting

One entry per error pxsig prints, with its cause and its fix. The quoted lines are pxsig's own
text, word for word (a test keeps them in step with the code); a part that changes per run, such
as a path or a count, is left out. `pxsig help troubleshooting` prints the short form.

## Storybook is not reachable

> setup error: Storybook is not reachable at

> Storybook's story index is broken

**Cause.** A full check, `pxsig manifest` and the server's checks first ask `storybook.url` for
its `index.json`. Nothing answered (not reachable), or what answered is not a story index
(broken). Nothing is rendered or recorded; the exit is 2.

**Fix.**

- Not reachable: start Storybook, or point `storybook.url` (`--storybook-url`) at a running one,
  or set `storybook.staticDir` to a built Storybook, which pxsig then serves itself
  ([configuration.md](configuration.md)).
- Broken: the Storybook terminal shows why the index failed to build (usually a story file that
  does not compile). Fix that and run the check again. A broken index is never replaced by
  `storybook.staticDir`.

## No manifest

> no readable manifest at

> run `pxsig manifest` first

**Cause.** The store has no `manifest.json`, or it cannot be read. The manifest lists every story
with its modes and states; checks select from it.

**Fix.** With Storybook running, `pxsig manifest` writes it; commit it with the store
([cli.md](cli.md)).

## No Chromium

> no Chromium for the check

> install it with `npx playwright install chromium`

**Cause.** Stories render in Chromium from the project's Playwright. When Playwright's own
Chromium is missing, pxsig tries the installed Google Chrome, then Microsoft Edge
([platforms.md](platforms.md#which-browser-renders)). When none of the three starts, a check
stops with the last error Playwright gave, which names Edge (`msedge`), the last one tried, even
though Chromium is the one missing. `pxsig dashboard check` prints the first quoted line instead.

**Fix.** In the project, `npx playwright install chromium` (on Linux, add `--with-deps` the first
time, for the system libraries). Or render in the pxsig container: `pxsig browser start`
([container.md](container.md)).

## A different Storybook on the port

> renders hit Storybook's error page

> Storybook shows "no preview"

**Cause.** Something answers at `storybook.url`, but it is not this project's Storybook: another
project's, or an old one still running. Its index has none of this project's stories, so each
render shows Storybook's "no preview" page. When most renders do, the check stops as a setup error
and records nothing (exit 2). Storybook offers the next free port when its own is taken, so the
project's Storybook may be running on another port.

**Fix.** Stop the other Storybook, or point `storybook.url` at the port this project's Storybook
printed when it started.

## A server for another workspace

> serves another workspace

> does not say which workspace it serves (pxsig 0.6 or earlier)

**Cause.** No server runs for this workspace, so the CLI tried the default port, and another
workspace's server answers there (another checkout, worktree or project). pxsig does not use it:
its stores, Storybook and decisions are that workspace's. Commands that can run without a server
run here instead; the rest stop. The Storybook panel passes over it the same way.

**Fix.** Start a server in this workspace (`pxsig serve`; it takes the next free port when 6070 is
taken), or set `PXSIG_URL` to the server you mean.

## The store is locked

> holds the store

> wait for it to finish

**Cause.** One process writes a store at a time (`<store>/reports/.lock`,
[monorepo.md](monorepo.md#store-layout)). Another command (a full check, an update, a repair, a
migration) or the server is writing it. The message names it, its process id and when it started.
The exit is 2.

**Fix.**

- Wait for that command to finish, or stop the server (Ctrl+C in its terminal). A full check
  against a store the server holds goes through the server, without this error.
- A lock whose process is gone (a closed terminal, `kill -9`) is taken over by the next command,
  with no error.
- A holder with no heartbeat for 10 minutes (a laptop that slept) can be taken over by a person at
  a terminal: the command asks for `TAKE OVER`.

> lock taken over by

This one is printed by the old holder when a person took its lock over: it stops before its next
write, and writes nothing more.

## Approving needs the dashboard link

> approving here needs the dashboard link: open the link `pxsig serve` printed, or run `pxsig serve --link` in a terminal

**Cause.** The dashboard was opened without the link `pxsig serve` printed at start, so the
browser has no session for approving. The HTTP answer is 403 with
`code: "needs-dashboard-link"` ([server.md](server.md#guards)). Reading the dashboard needs no
link.

**Fix.** Open the link the server printed, or run `pxsig serve --link` in a terminal for a new one.
A link has to be opened within two minutes and works once; once open, that browser can approve with
no time limit until the server stops or the browser closes. The dashboard's top bar says which it
is: **Read only**, or **Can approve**.

## A program is blocked on this machine

> it may be blocked on this machine

**Cause.** A program pxsig starts (`git`, the engine, `node`, …) was refused by the operating
system (`EACCES` or `EPERM`): an application-control policy (AppLocker, WDAC), a sandbox, or a
binary without its execute permission.

**Fix.** The error names the program. [platforms.md](platforms.md#programs-pxsig-starts) lists
every program pxsig starts, when and why; that list is what to allow. On macOS and Linux, check
the engine binary's execute permission (`chmod +x`).

> pxsig does not start

This one is pxsig's own refusal: the program is not on that list for this OS, so pxsig did not
try. It points at a bug in pxsig; report it with the command that printed it.

## A JSON file saved as UTF-16

> save it as UTF-8

**Cause.** `pxsig.config.json` or `pxsig.workspace.json` was saved as UTF-16; the message names the
file and the byte order (`LE` or `BE`). Windows Notepad's "Unicode" encoding writes UTF-16, and so
does Windows PowerShell 5's `>` redirect (`echo '…' > pxsig.workspace.json`). A UTF-8 file with a
byte order mark (Notepad's "UTF-8 with BOM", PowerShell 5's `-Encoding UTF8`) is fine: pxsig skips
the mark.

**Fix.** Save the file as UTF-8 (in VS Code: "Save with Encoding", "UTF-8"; in PowerShell,
`Set-Content -Encoding utf8`), or create it in an editor.
