# pxsig

Visual regression for Storybook: compact pixel signatures with their baseline images in one
`.psig` file per story state, a Rust engine, a local dashboard, a Storybook addon and an MCP
server. Runs offline, on your machine and in your CI.

<img src="https://raw.githubusercontent.com/hydrotik/pxsig/main/docs/product-shots/overview.png" width="900" alt="The pxsig dashboard's Overview in the middle of a review: status cards (42 checked, 32 passed, 6 changed, 1 new accessibility violation), open items with review actions, a stale-entries heatmap by component, an errors card with the safe-repair actions, and the changed entries across 14 runs.">

<img src="https://raw.githubusercontent.com/hydrotik/pxsig/main/docs/product-shots/inspector.png" width="900" alt="The inspector reviewing a changed project card, first of six: the baseline render and the latest render side by side, the moved badge and buttons highlighted and boxed, the changed regions listed, and the metrics that failed the gate (SSIM 0.64 below 0.99, 50 detail tiles changed), with Reject and Approve.">

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

Peer dependencies, both optional to npm, so neither is installed for you: `playwright` 1.58 or later
(the oldest version CI tests), which renders need: install it beside pxsig, as above; `react` 19 or
later, needed only by `pxsig/diff-viewer` and `pxsig dashboard build`. The engine binary comes from
a per-platform package `@pxsig/cli-<platform>-<arch>`, installed with it; `PXSIG_BIN` points at
another build.

## Network

pxsig talks only to what runs on your machine, or to an address you configure. It sends no
telemetry and checks for no updates.

- `pxsig serve` (the dashboard) and `pxsig dashboard check` listen on `127.0.0.1` only; the
  dashboard's default port is 6070.
- `check`, `approve`, `doctor` and the MCP tools call that dashboard server, at
  `http://127.0.0.1:6070` or the address in `PXSIG_URL`. The MCP server itself uses stdio.
- Renders load your Storybook at its configured address (`http://localhost:6006` by default). With
  `--browser <ws>`, Playwright drives the browser server at that address; the one
  `pxsig browser start` runs is published on `127.0.0.1` only.
- `pxsig browser start|stop|status` are the only commands that run `docker`; `start` pulls the
  image `ghcr.io/hydrotik/pxsig` when it is not on the machine yet.
- The Storybook addon asks the pxsig servers its preset names (`127.0.0.1` by default) for their
  status; on a deployed Storybook it reads only the snapshot file published beside it.

Other URLs in the code are written into output, never requested: the SARIF report's schema, rule
help and project links, and links in the docs.

## First run

The first `check --full` exits 1, because no entry has a baseline yet. Approve the first renders in
the dashboard (press `A` in the inspector), or plan them in bulk with
`npx pxsig approve plan --new --first-baselines --reason "first baselines"` and apply the plan with
`npx pxsig approve apply` (a person at a terminal, with the server running). `pxsig help approvals`
has the rest.

## Documentation

Offline, in the package: `pxsig help` (every command), `pxsig help <command>`, and the topics
`agents`, `approvals`, `catalog`, `ci`, `dashboard`, `exit-codes`, `platforms` and
`troubleshooting`.

Online: [CLI](https://github.com/hydrotik/pxsig/blob/main/docs/cli.md),
[configuration](https://github.com/hydrotik/pxsig/blob/main/docs/configuration.md),
[monorepos](https://github.com/hydrotik/pxsig/blob/main/docs/monorepo.md),
[spec](https://github.com/hydrotik/pxsig/blob/main/docs/spec.md),
[integrity](https://github.com/hydrotik/pxsig/blob/main/docs/integrity.md),
[server](https://github.com/hydrotik/pxsig/blob/main/docs/server.md),
[MCP](https://github.com/hydrotik/pxsig/blob/main/docs/mcp.md),
[CI](https://github.com/hydrotik/pxsig/blob/main/docs/ci.md).

MIT. Copyright (c) 2026 Hydrotik LLC.
