# Example: a monorepo with two projects behind one Storybook

`pxsig.workspace.json` lists the projects; each has its own `pxsig.config.json` and its own store.
One install of pxsig at the root serves both, and `apps/storybook` renders the stories of both.

| Project | Folder | Store |
| --- | --- | --- |
| `ui` | `packages/ui` | `packages/ui/.pxsig/` (layout `package`) |
| `forms` | `packages/forms` | baselines beside each component in `__pxsig__/` (layout `colocated`), the rest in `packages/forms/.pxsig/` |

`forms` depends on `ui`, so an edit to `packages/ui/src` marks the `forms` entries that import it
as affected (`affects.workspaceDeps`, on by default).

```bash
pnpm install
pnpm build-storybook && npx http-server apps/storybook/storybook-static -p 6407 -s &
npx pxsig projects
npx pxsig manifest --project ui && npx pxsig manifest --project forms
npx pxsig check --full --project ui
npx pxsig serve                      # one dashboard for both projects
```
