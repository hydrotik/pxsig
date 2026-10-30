# Example: the dashboard on your own UI

A deliberately plain UI adapter (`pxsig-ui/`): the pxsig dashboard rebuilt on semantic HTML and
one stylesheet, the shape an adapter on a real design system starts from. It implements every
required contract component and a few optional ones; the rest render the dashboard's fallbacks.

```bash
pnpm install
pnpm dashboard:gaps     # pxsig dashboard gaps: what the adapter covers, and what it leaves to fallbacks
pnpm dashboard:build    # pxsig dashboard build: node_modules/.cache/pxsig/dashboard
pnpm dashboard:check    # pxsig dashboard check: every screen on it, a gallery beside the reference
pxsig serve             # serves that build while it is newer than pxsig-ui/
```

`pxsig.config.json` names the adapter (`"dashboard": { "ui": "./pxsig-ui" }`). pxsig also ships
this adapter as the built-in `plain` (`--ui plain`, and the default when nothing names one); this
copy shows how a project writes its own, importing the contract from `pxsig/dashboard`. The adapter's types
come from `pxsig/dashboard`; the instructions for writing one, component by component, are in
`node_modules/pxsig/docs/ui/build-adapter.md`.

This example stays on Vite 6 and `@vitejs/plugin-react` 4 on purpose: `pxsig dashboard build` runs
on the project's own Vite, and pxsig's own release build is on Vite 8, so CI builds the dashboard at
both ends of the supported range.
