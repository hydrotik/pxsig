# Storybook addon

`@pxsig/storybook-addon` shows pxsig inside Storybook: a "PXSIG: Visual regression" panel for the
current story, and a status dot on every story in the sidebar. It is a thin client of the pxsig
server (`pxsig serve`): it renders nothing and writes nothing itself.

## Install

```bash
npm install -D @pxsig/storybook-addon
```

Register it in `.storybook/main.ts` (or `main.js`):

```ts
const config = {
  addons: ['@pxsig/storybook-addon'],
};
export default config;
```

With options:

```ts
addons: [{ name: '@pxsig/storybook-addon', options: { server: 'http://127.0.0.1:6070' } }],
```

| Option | Meaning |
| --- | --- |
| `server` | The pxsig server's URL. Only needed when the server is not found on its own. |

The addon needs Storybook 9 or later (the examples in this repository use Storybook 10). Its
manager code imports `storybook/manager-api` and `storybook/internal/components` from your
Storybook install.

Then start the server from the repository root:

```bash
npx pxsig serve --watch
```

## Finding the server

The preset runs in Node when Storybook starts. It walks up from Storybook's config folder to the
pxsig workspace and gives the manager page a list of candidate URLs, in this order:

1. the `server` option;
2. the URL in `<workspace>/node_modules/.cache/pxsig/server.json`, written by the running server;
3. `server.port` from `pxsig.workspace.json`;
4. `http://127.0.0.1:6070`.

A `pxsig-server` key in the browser's `localStorage` goes before all of them. The panel uses the
first candidate that answers `/__pxsig/status`, and keeps it until it stops answering.

The server must accept the addon's requests. It accepts POSTs from the origin of every served
project's `storybook.url`, so set `storybook.url` to the address Storybook really runs on.

## Sidebar statuses

The dots come from `/__pxsig/status` and refresh on the server's event stream. With
`pxsig serve --watch`, editing a component re-checks it and the dots update without a reload.

| pxsig state | Storybook status |
| --- | --- |
| `pass`, `drift`, `approved` | success |
| `changed`, `flaky`, `new` | warn: needs review, not a failure |
| `rejected`, `error` | error |
| `skipped`, not checked | unknown |

The tooltip lists each mode's state and SSIM.

Integrity can raise a story's status. An error-severity code (`unregistered`, `never-checked`,
`missing-baseline-image`, `render-error`) turns the dot red, and a story that no entry covers gets
a red dot too, so a gap shows without opening the panel.

## Panel

- A header with the story's status per mode, an integrity badge when the story has an issue, and
  three buttons:
  - **Check story** queues a render and check of every entry of this story (a story that is not
    in the manifest yet is registered first, its entries NEW and unapproved);
  - **Check all** queues every entry, in every project the server holds;
  - **Open dashboard** opens the dashboard on this story.
- Below it, the dashboard's inspector for the story: baseline, current render and diff, with
  approve and reject.

The header and its buttons take their colours from Storybook's theme, and the inspector and the
dashboard open in Storybook's light or dark mode (`?theme=` on the dashboard URL, which wins over
the mode the dashboard remembers).

When the server is not running, the panel says so and shows the command to start it.

## Several projects

One Storybook can show stories from several projects, and one server can hold several projects.
The addon sends only story and entry ids; the server works out which project owns each one.
