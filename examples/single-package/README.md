# Example: a single-package project

One package, one Storybook, one store. There is no `pxsig.workspace.json`: `pxsig.config.json` at
the root makes the package its own workspace.

```bash
pnpm install
pnpm build-storybook && npx http-server storybook-static -p 6406 -s &
npx pxsig manifest            # list every story × mode
npx pxsig check --full        # render and check (every entry is NEW the first time)
npx pxsig serve               # review and approve the first renders in the dashboard
```

The store, `.pxsig/`, is created by the first run. Its baselines (`.psig`), manifest and approval
log are what this project commits; renders, diffs and reports stay out of git (see `.pxsig/.gitignore`).
This example's store is not committed here: the pxsig repository never contains baselines.
