# Troubleshooting

Each error as pxsig prints it (the quoted part, word for word), its cause and its fix. The full
page, with more detail: docs/troubleshooting.md.

**Storybook is not reachable**

> setup error: Storybook is not reachable at

Nothing answers at `storybook.url`; nothing is rendered (exit 2). Start Storybook, point
`storybook.url` (`--storybook-url`) at a running one, or set `storybook.staticDir` to a built one.

> Storybook's story index is broken

The Storybook terminal shows why (usually a story that does not compile); fix it and re-run.

**No manifest**

> no readable manifest at

> run `pxsig manifest` first

With Storybook running, `pxsig manifest` writes the store's `manifest.json`; commit it.

**No Chromium**

> no Chromium for the check

> install it with `npx playwright install chromium`

pxsig tries Playwright's Chromium, then the installed Chrome, then Edge. When none starts, a check
prints Playwright's last error, which names Edge (`msedge`) although Chromium is the one missing.
Run `npx playwright install chromium` in the project (on Linux, `npx playwright install-deps chromium`
for the system libraries), or `pxsig browser start` to render in the container.

**A different Storybook on the port**

> renders hit Storybook's error page

> Storybook shows "no preview"

The Storybook at `storybook.url` is not this project's, so it has none of its stories (exit 2,
nothing recorded). Stop the other one, or point `storybook.url` at the port this project's
Storybook printed.

**A server for another workspace**

> serves another workspace

> does not say which workspace it serves (pxsig 0.6 or earlier)

The server on the port (6070 when none runs here) is another workspace's, so pxsig does not use
it. Start `pxsig serve` in this workspace, or set `PXSIG_URL` to the server meant.

**The store is locked**

> holds the store

> wait for it to finish

Another command or the server is writing the store (exit 2). Wait for it, or stop the server. A
lock whose process is gone is taken over by the next command; one quiet for 10 minutes, by a person
at a terminal who types `TAKE OVER`.

**Approving needs the dashboard link**

> approving here needs the dashboard link: open the link `pxsig serve` printed, or run `pxsig serve --link` in a terminal

HTTP 403, `code: "needs-dashboard-link"`. Open the link `pxsig serve` printed (single use, two
minutes), or run `pxsig serve --link` in a terminal.

**A program is blocked on this machine**

> it may be blocked on this machine

A policy (AppLocker, WDAC, a sandbox) or a missing execute permission refused a program pxsig
starts. `pxsig help platforms` lists them all, with why; that list is what to allow.

**A JSON file saved as UTF-16**

> save it as UTF-8

`pxsig.config.json` or `pxsig.workspace.json` is UTF-16, written by Notepad's "Unicode" and by
Windows PowerShell 5's `>`. Save it as UTF-8 (a byte order mark is fine).
