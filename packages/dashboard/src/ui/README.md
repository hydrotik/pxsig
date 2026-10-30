# The UI contract

The dashboard renders through a small contract of neutral components, so it can be built on any
design system. Views, parts, the inspector and `App.tsx` import components from `@ui` only; `pnpm
ui:check` fails on a design-system import anywhere outside `adapters/`.

| File                 | What it is                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contract.ts`        | Every contract component's props and semantics, the 11 contract rules, the `CONTRACT` table (group, required, role) and the `UiAdapter` type.                |
| `tokens.ts`          | The neutral theme tokens (`--pxsig-*`) the dashboard's own stylesheets read, and the `TokenMap` every adapter fills.                                         |
| `index.ts`           | `@ui`: the build-selected adapter under the contract's names, with the plain fallback for any optional component it lacks, plus `UiRoot` and `useThemeMode`. |
| `runtime.tsx`        | Theme mode (owned here, passed to the adapter's provider) and the token declarations.                                                                        |
| `fallbacks.tsx`      | Plain, accessible renderings of the optional components.                                                                                                     |
| `features.ts`        | Every dashboard feature as data (docs/ui/features.md is generated from it).                                                                                  |
| `manifest.json`      | Generated (`pnpm ui:manifest`): each contract component, its role, the files that render it.                                                                 |
| `adapters/hydrotik/` | The reference adapter: `index.tsx`, `conformance.json`, and `vite.mjs` (its build settings).                                                                 |
| `adapters/plain/`    | The plain adapter (semantic HTML, `theme.css`): the default build. `examples/custom-ui/pxsig-ui` is the same adapter written as a project's own.             |

## An adapter

An adapter is one module whose named exports are `name`, `tokens` (a value for every token) and
the contract components. Required components (`required: true` in `CONTRACT`) must be exported;
an optional one it leaves out renders the fallback. Beside the module, `conformance.json` says
how fully each component is covered (`full`, `partial`, `bespoke`, `missing`) with a note, and an
optional `vite.mjs` returns build settings (aliases, folders to allow) for its design system.

The step-by-step instructions, one section per component, are in
[docs/ui/build-adapter.md](../../../../docs/ui/build-adapter.md).

## Building with one

```bash
pnpm build:dashboard                                    # plain; hydrotik when PXSIG_DS_SOURCE is set
PXSIG_UI_ADAPTER=hydrotik pnpm build:dashboard          # a built-in adapter, by name
PXSIG_UI_ADAPTER=./path/to/adapter pnpm build:dashboard # a module, by path
pnpm ui:gaps                                            # what the adapter covers, and what it does not
```

In a project that uses pxsig: `"dashboard": { "ui": "./pxsig-ui" }` in `pxsig.config.json`, then
`pxsig dashboard build` and `pxsig dashboard gaps` (docs/ui/build-adapter.md). An unknown name or a
path with no module fails the build at once.
