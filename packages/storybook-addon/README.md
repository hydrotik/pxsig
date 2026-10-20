# @pxsig/storybook-addon

pxsig inside Storybook: a "PXSIG: Visual regression" panel with the inspector for the current
story, and a status dot on every story in the sidebar. It is a client of the pxsig server; start
it with `npx pxsig serve --watch`.

```bash
npm install -D @pxsig/storybook-addon
```

`.storybook/main.ts`:

```ts
const config = {
  addons: ['@pxsig/storybook-addon'],
  // or: [{ name: '@pxsig/storybook-addon', options: { server: 'http://127.0.0.1:6070' } }]
};
export default config;
```

The addon finds the server on its own: the `server` option, else the address the running server
wrote for the workspace, else the workspace's configured port, else `http://127.0.0.1:6070`.

Requires Storybook 9 or later (tested on 10.6). It imports `storybook/manager-api` and
`storybook/internal/components`, and reports sidebar statuses through Storybook's status store
(`experimental_getStatusStore`); none of those exist in Storybook 8, so Storybook 8 is not
supported.

Full documentation: [docs/storybook.md](../../docs/storybook.md).

MIT. Copyright (c) 2026 Hydrotik LLC.
