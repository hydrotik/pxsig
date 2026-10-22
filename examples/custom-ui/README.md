# Example: the dashboard on your own UI

A deliberately plain UI adapter (`pxsig-ui/`): the pxsig dashboard rebuilt on semantic HTML and
one stylesheet, the shape an adapter on a real design system starts from. It implements every
required contract component and a few optional ones; the rest render the dashboard's fallbacks.

```bash
pnpm install
pnpm dashboard:gaps     # pxsig dashboard gaps: what the adapter covers, and what it leaves to fallbacks
pnpm dashboard:build    # pxsig dashboard build --out dashboard-build
PXSIG_DASHBOARD_DIR=dashboard-build pxsig serve
```

`pxsig.config.json` names the adapter (`"dashboard": { "ui": "./pxsig-ui" }`). The adapter's types
come from `pxsig/dashboard`; the instructions for writing one, component by component, are in
`node_modules/pxsig/docs/ui/build-adapter.md`.
