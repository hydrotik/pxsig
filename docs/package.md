# The pxsig package

What the npm package `pxsig` holds, what it exports, what it needs beside it and what it talks to
on the network. The [README](../README.md) introduces pxsig; [QUICKSTART.md](../QUICKSTART.md)
installs it.

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
| `pxsig/workspace`                                                  | The resolver: `openProject`, `findWorkspace`, `pickProject`, `loadProject` and `SetupError`, with TypeScript types                                       |
| `pxsig/psig`                                                       | Read `.psig` headers and images (`readHeader`, `readSection`, `readImage`, `hasImage`), with TypeScript types                                            |
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
- `check`, `approve`, `doctor`, `status` and the MCP tools call this workspace's dashboard server:
  `PXSIG_URL`, else the address `pxsig serve` recorded, else `server.port` (6070). A server that
  serves another workspace is not used. The MCP server itself uses stdio.
- Renders load your Storybook at its configured address (`http://localhost:6006` by default). With
  `--browser <ws>`, Playwright drives the browser server at that address; the one
  `pxsig browser start` runs is published on `127.0.0.1` only.
- `pxsig browser start|stop|status` are the only commands that run `docker`; `start` pulls the
  image `ghcr.io/hydrotik/pxsig` when it is not on the machine yet.
- The Storybook addon asks the pxsig servers its preset names (`127.0.0.1` by default) for their
  status; on a deployed Storybook it reads only the snapshot file published beside it.

Other URLs in the code are written into output, never requested: the SARIF report's schema, rule
help and project links, and links in the docs.

## Help in the package

Offline, in the package: `pxsig help` (every command), `pxsig help <command>`, and the topics
`agents`, `approvals`, `catalog`, `ci`, `dashboard`, `exit-codes`, `platforms` and
`troubleshooting`. [CLI reference](cli.md) has every command and flag online.
