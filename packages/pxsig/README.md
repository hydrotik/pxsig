# pxsig

Visual regression for Storybook: compact pixel signatures with their baseline images in one
`.psig` file per story state, a Rust engine, a local dashboard, a Storybook addon and an MCP
server. Runs offline, on your machine and in your CI.

> Not published to npm yet. See the repository README for running from a clone.

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

| Path | Content |
| --- | --- |
| `bin/pxsig.mjs` | The `pxsig` command (hands over to the workspace root's install when there is one) |
| `src/` | CLI, workspace resolver, renderer, full check, server, MCP server, integrity, approvals |
| `schema/workspace.json`, `schema/project.json` | JSON Schemas for `pxsig.workspace.json` and `pxsig.config.json` |
| `dist/dashboard/` | The prebuilt dashboard (in the published package) |

Module exports: `pxsig/workspace` (the resolver) and `pxsig/psig` (read `.psig` headers and images).

Peer dependency: `playwright` 1.40 or later. The engine binary comes from a per-platform package
`@pxsig/cli-<platform>-<arch>` once published; `PXSIG_BIN` points at another build.

## Documentation

<https://github.com/hydrotik/pxsig/tree/main/docs>: [CLI](../../docs/cli.md),
[configuration](../../docs/configuration.md), [monorepos](../../docs/monorepo.md),
[spec](../../docs/spec.md), [integrity](../../docs/integrity.md), [server](../../docs/server.md),
[MCP](../../docs/mcp.md), [CI](../../docs/ci.md).

MIT. Copyright (c) 2026 Hydrotik LLC.
