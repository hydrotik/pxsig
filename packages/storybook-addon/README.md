# @pxsig/storybook-addon

pxsig inside Storybook: a "PXSIG: Visual regression" panel with the inspector for the current
story, and a status dot on every story in the sidebar. The addon is a client of the pxsig server
(`pxsig serve`): it renders nothing and writes no baselines itself. On a Storybook deployed to a
shared server, the panel shows a read-only snapshot instead.

## Install

The addon works beside [`pxsig`](https://www.npmjs.com/package/pxsig) in the same project:

```bash
npm install -D pxsig playwright @pxsig/storybook-addon
npx playwright install chromium
```

pxsig renders stories with Playwright, an optional peer it does not install itself;
[pxsig's README](https://github.com/hydrotik/pxsig#readme) has the full setup (`pxsig init`, the
store, the first check).

Register it in `.storybook/main.ts` (or `main.js`):

```ts
const config = {
  addons: ['@pxsig/storybook-addon'],
};
export default config;
```

Then start the server from the repository root, and Storybook as usual:

```bash
npx pxsig serve --watch
```

With `--watch`, editing a component re-checks its stories and the sidebar updates without a
reload. When no server is running, the panel says so and shows the command that starts one.

## Options

```ts
addons: [
  {
    name: '@pxsig/storybook-addon',
    options: { server: 'http://127.0.0.1:6070', snapshot: true },
  },
],
```

| Option     | Default | Meaning                                                                              |
| ---------- | ------- | ------------------------------------------------------------------------------------ |
| `server`   | none    | The pxsig server's URL. Only needed when the server is not found on its own (below). |
| `snapshot` | `true`  | `false`: `storybook build` runs no `pxsig snapshot` and the build has no snapshot.   |

## Finding the server

The preset runs in Node when Storybook starts. It walks up from Storybook's config folder to the
pxsig workspace (a `pxsig.workspace.json`, else a `pxsig.config.json`) and gives the manager page
these candidate URLs, in order:

1. the `server` option;
2. the URL in `node_modules/.cache/pxsig/server.json` at the workspace root, written by the
   running server;
3. `server.port` from `pxsig.workspace.json`;
4. `http://127.0.0.1:6070`.

A `pxsig-server` key in the browser's `localStorage` goes before all of them. The panel uses the
first candidate that answers `/__pxsig/status` for this workspace and keeps it until it stops
answering. The preset gives the page the workspace's id (the first 16 hex characters of the
SHA-256 of its path, never the path), and each server's status answer names its own, so a server
for another workspace on the default port is passed over. A server from pxsig 0.6 or earlier
names no workspace and is used only at candidates 1 to 3.

The server accepts the addon's requests from the origin of every served project's
`storybook.url`, so `storybook.url` in `pxsig.config.json` is the address Storybook really runs on.

## Sidebar statuses

The dots come from `/__pxsig/status` and refresh on the server's event stream. Each tooltip lists
the story's modes with their state and SSIM.

| pxsig state                 | Storybook status                  |
| --------------------------- | --------------------------------- |
| `pass`, `drift`, `approved` | success                           |
| `changed`, `flaky`, `new`   | warn: needs review, not a failure |
| `rejected`, `error`         | error                             |
| `skipped`, not checked      | unknown                           |

An error-severity integrity code (`unregistered`, `never-checked`, `missing-baseline-image`,
`render-error`) turns a story's dot red, and so does a story that no entry covers, so a gap shows
without opening the panel.

## The panel

- A header with the story's status per mode, an integrity badge when the story has an issue, and
  three buttons: **Check story** (renders and checks every entry of this story, registering a
  story that is not in the manifest yet as new and unapproved), **Check all** (every entry, in
  every project the server holds) and **Open dashboard** (the dashboard on this story).
- The dashboard's inspector for the story: baseline, current render and diff, with approve and
  reject. A decision opens a small window of the pxsig server for a moment, which records it and
  closes; that needs the dashboard link opened once in this browser since `pxsig serve` started.
  The browser may ask once to allow pop-ups for Storybook.

The header takes its colours from Storybook's theme, and the inspector and the dashboard open in
Storybook's light or dark mode. One Storybook can show stories from several projects: the addon
sends only story and entry ids, and the server works out which project owns each one.

## On a deployed Storybook

The live panel is for a Storybook served from this computer (`localhost`, `127.0.0.1`, `[::1]`).
On any other address (a Storybook deployed to dev, UAT or pre-prod) the addon makes no request to
any pxsig server and shows no sidebar dots. Its panel is read-only and shows the snapshot the
build carries, `pxsig-snapshot.json`, made from the committed store at the commit built: for each
entry of the story, its mode, whether it has a baseline, the last approval (date, pull request,
commit, colour or shape change), the render environment and the accepted accessibility rules; and
the story's history by batch. The snapshot holds no names, emails, paths, reasons or images.
Without one, the panel says that pxsig runs on a developer's own computer. A `pxsig-server` key in
`localStorage` still forces the live panel.

## What runs at build time

On `storybook build` only (never `storybook dev`), the preset runs the workspace's own pxsig once
to write the snapshot: Node's `spawnSync` starts the Node that runs Storybook on
`node_modules/pxsig/bin/pxsig.mjs snapshot --out <file> --workspace <root>`, with no shell, in the
workspace root, with a 2 minute timeout. `pxsig snapshot` reads the committed store and git only
and sends nothing over the network. The file is written to
`node_modules/.cache/pxsig/storybook/pxsig-snapshot.json` and served from the root of the build.

It runs because a deployed Storybook has no pxsig server to ask. It never fails a build: when pxsig
is not installed in the workspace, or the command fails, the build prints one line starting
`pxsig: no snapshot in this build` and goes on without the file. To turn it off:

```ts
addons: [{ name: '@pxsig/storybook-addon', options: { snapshot: false } }],
```

## Compatibility

Requires Storybook 10 or later (tested on 10.6). The manager code imports `storybook/manager-api`
and `storybook/internal/components`, and reports sidebar statuses through Storybook's status store
(`experimental_getStatusStore`); none of those exist in Storybook 8. Storybook 9 has them but is
not tested, so the peer range starts at 10. The peer is optional: npm does not install a Storybook
with the addon, which runs inside the one the project already has. The addon has no dependencies
of its own and needs Node 22 or later.

## Documentation

- [Storybook addon](https://github.com/hydrotik/pxsig/blob/main/docs/storybook.md): the full
  reference for this package.
- [A deployed Storybook](https://github.com/hydrotik/pxsig/blob/main/docs/team.md#a-deployed-storybook):
  the snapshot, and what each environment shows.
- [Server](https://github.com/hydrotik/pxsig/blob/main/docs/server.md): `pxsig serve`, its routes
  and its guards.
- [pxsig](https://github.com/hydrotik/pxsig#readme): what pxsig does and how to start.
- [Issues](https://github.com/hydrotik/pxsig/issues)

MIT. Copyright (c) 2026 Hydrotik LLC.
