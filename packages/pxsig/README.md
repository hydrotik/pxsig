# pxsig

Visual regression for Storybook: compact pixel signatures with their baseline images in one
`.psig` file per story state, a Rust engine, a local dashboard, a Storybook addon and an MCP
server. Runs offline, on your machine and in your CI.

<img src="https://raw.githubusercontent.com/hydrotik/pxsig/main/docs/product-shots/overview.png" width="900" alt="The pxsig dashboard's Overview in the middle of a review: status cards (42 checked, 6 changed, 1 new accessibility violation), open items with review actions, a stale-entries heatmap by component, an errors card with the safe-repair actions, and the changed entries across 14 runs.">

<img src="https://raw.githubusercontent.com/hydrotik/pxsig/main/docs/product-shots/inspector.png" width="900" alt="The inspector reviewing a changed card: the baseline render and the latest render side by side, the changed pixels and detail tiles highlighted, three changed regions listed, and the metrics that failed the gate (SSIM 0.64 below 0.99, 50 detail tiles changed) with Approve, Reject and Approve story.">

```bash
npm install -D pxsig playwright
npx playwright install chromium

npx pxsig init              # pxsig.config.json and the .pxsig/ store
npx pxsig manifest          # every story x mode x state, from the running Storybook
npx pxsig check --full      # render and check
npx pxsig serve             # dashboard: review and approve
npx pxsig doctor            # what the check does not cover
```

## What the package contains

| Path                                           | Content                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `bin/pxsig.mjs`                                | The `pxsig` command (hands over to the workspace root's install when there is one)      |
| `src/`                                         | CLI, workspace resolver, renderer, full check, server, MCP server, integrity, approvals |
| `schema/workspace.json`, `schema/project.json` | JSON Schemas for `pxsig.workspace.json` and `pxsig.config.json`                         |
| `dist/dashboard/`                              | The prebuilt dashboard (in the published package)                                       |

Module exports:

| Export                                                             | Content                                                                                                                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pxsig/workspace`                                                  | The resolver: `openProject`, `findWorkspace`, `pickProject`, `loadProject` and `SetupError`                                                              |
| `pxsig/psig`                                                       | Read `.psig` headers and images                                                                                                                          |
| `pxsig/dashboard`                                                  | The dashboard's UI contract, types only (`import type * as C from 'pxsig/dashboard'`); loading it at run time throws                                     |
| `pxsig/diff-viewer`                                                | The diff viewer's React parts as TypeScript source, for a bundler that compiles TypeScript and JSX (Vite, as `pxsig dashboard build` uses); not for Node |
| `pxsig/ui/catalog/hydrotik.json`, `….schema.json`, `….source.json` | The reference design system's component catalog, its schema and its source commit                                                                        |

Peer dependencies: `playwright` 1.58 or later (the oldest version CI tests); `react` 19 or later, optional, needed only by
`pxsig/diff-viewer` and `pxsig dashboard build`. The engine binary comes from a per-platform package
`@pxsig/cli-<platform>-<arch>` once published; `PXSIG_BIN` points at another build.

## Documentation

<https://github.com/hydrotik/pxsig/tree/main/docs>: [CLI](../../docs/cli.md),
[configuration](../../docs/configuration.md), [monorepos](../../docs/monorepo.md),
[spec](../../docs/spec.md), [integrity](../../docs/integrity.md), [server](../../docs/server.md),
[MCP](../../docs/mcp.md), [CI](../../docs/ci.md).

MIT. Copyright (c) 2026 Hydrotik LLC.
