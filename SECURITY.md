# Security

## Reporting a vulnerability

Please report security problems privately, through GitHub's private vulnerability reporting on
the repository: <https://github.com/hydrotik/pxsig/security/advisories/new>. Do not open a public
issue.

Include what you found, how to reproduce it, and what an attacker could do with it. We will
acknowledge the report, keep you informed, and credit you in the advisory unless you prefer not
to be named.

## Supported versions

pxsig is at 0.x. Fixes go into the latest release only.

## Verifying a download

Every release from 0.4.0 on carries, on its GitHub release page, a `SHA256SUMS` file, a provenance
attestation for each file, and CycloneDX SBOMs (`pxsig-npm.cdx.json` for what installing the npm
package brings in, `pxsig-engine.cdx.json` for the Rust crates in the binary). The attestation is
GitHub's signed record of the workflow run and commit that built the file. The binaries are not
code-signed. The commands are in [docs/releasing.md](docs/releasing.md#verifying-a-release).

## How pxsig is meant to run

pxsig is a developer and CI tool. It runs on your machine or your runner, against your own
Storybook.

- **The server binds to `127.0.0.1` only.** It is not reachable from other machines.
- **It refuses cross-origin writes.** A POST that carries an `Origin` header is accepted only from
  the server's own origin or from a served project's Storybook origin. A page on any other site
  cannot approve, reject or start checks. CORS headers are sent only to those Storybook origins.
- **Decisions through the server need the dashboard link or a token.** Approve, reject, unreview
  and the accessibility decisions need either the dashboard link (a one-time link `pxsig serve`
  prints for a person at a terminal, traded by the page for a cookie scripts cannot read; no token
  is ever in a page) or one of the random tokens the server makes when it starts, in a file only
  your user can read
  (`node_modules/.cache/pxsig/serve-<port>.token`; on Windows in the user's own
  `%LOCALAPPDATA%\pxsig\`, with no permission change), which `pxsig approve apply` reads after its
  person-at-a-terminal check. An agent or a script posting to the server is refused. The token
  used, not the request, sets `via` in the approval log. A third file token lets the MCP server
  reject entries and clear rejections, nothing else. This is a
  guard, not authentication: a process running as you can read that file, as it could edit the
  baselines directly. Checks and repairs need no token.
- **Requests from another site are refused, and so are hosts that are not loopback.** A POST whose
  `Sec-Fetch-Site` is not `same-origin` is treated like a foreign `Origin`, and a request whose
  `Host` is not 127.0.0.1, localhost or [::1] is refused (DNS rebinding).
- **Requests without an `Origin` header can check and repair.** Any process on the same machine
  can start checks, as it could run them directly.
- **Approvals need a person.** Bulk approval, `check --full --update` and `a11y --prune` are refused when output is
  piped, in CI, or under a coding assistant's marker ([docs/agents.md](docs/agents.md)), and ask
  for a typed phrase. A marker is a hint, not proof: some assistants set none, and any process can
  set or unset one. The guarantee is the reviewed pull request that commits the baselines; every
  log line written under a marker names the assistant (`agent`). No MCP tool can approve or
  accept a baseline or an accessibility violation: `pxsig_status`, `pxsig_projects`, `pxsig_list`,
  `pxsig_entry`, `pxsig_history`, `pxsig_a11y`, `pxsig_affected`, `pxsig_stale`, `pxsig_help`
  read; `pxsig_check` re-renders; `pxsig_doctor` runs the safe repairs, which never change a
  baseline's signature or the log (one adds a missing image to a `.psig` only when it passes that
  signature's gate); `pxsig_review` marks rejections only, and refuses even those without `confirm: true`. Every
  approval is logged with hashes and the pxsig version, and can be undone. The approval log is not
  signed, and holds no personal data unless a team turns on `approvals.identity: "git-email"`:
  the commit that adds a line and the pull request say who approved (`pxsig approve log --trace`
  points at both, and shows no names). In CI, `pxsig approve verify` fails a baseline with no log
  line, or one whose bytes differ from it, and with `--since` a log that was rewritten rather than
  appended to ([docs/required-checks.md](docs/required-checks.md)).
- **The renderer loads your Storybook** in a real browser. Treat the stories you render like any
  code you run.

## What package scanners report

Supply-chain scanners (Socket, npm audit signatures, OpenSSF Scorecard and others) list what a
package can do. Each capability below is real; this is where it is in the code and what bounds it.

| Capability                | Where                                                                                                                    | Bounds                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Starts programs           | `src/lib/spawn.mjs`, the only module that imports `node:child_process`                                                   | A fixed list per OS (node, the engine, git, ps, osascript/open, xdg-open, fc-list, docker for `pxsig browser` only), never through a shell; anything else is refused ([docs/platforms.md](docs/platforms.md#programs-pxsig-starts)) |
| Network: a server         | `src/serve.mjs`, `src/lib/static.mjs`                                                                                    | Binds `127.0.0.1`; refuses hosts that are not loopback and foreign origins (above)                                                                                                                                                  |
| Network: requests         | `fetch` in `src/approve.mjs`, `check.mjs`, `cli/`, `tools/context.mjs`, `lib/repair.mjs`                                 | Only to the pxsig server: `http://127.0.0.1:<port>` by default (`serverUrlFor` in `src/lib/workspace.mjs`), or the address in `PXSIG_URL` when a person sets one. pxsig sends nothing anywhere else: no telemetry, no update check  |
| URL strings               | the `127.0.0.1` defaults; SARIF output's rule links and schema (`src/lib/sarif.mjs`)                                     | Written into reports, never fetched                                                                                                                                                                                                 |
| Environment variables     | `PXSIG_*` settings, CI and the coding-assistant markers (`src/lib/agents.mjs`), the OS's folder variables                | Read only. `USER`/`USERNAME` are read only when a team turns on `approvals.identity: "git-email"` and git has no email                                                                                                              |
| Filesystem                | the store, `node_modules/.cache/pxsig/`, the per-machine folder (`src/lib/machine.mjs`)                                  | Writes stay in the project, its store and that folder; repairs refuse to write a baseline (`src/lib/repair.mjs`)                                                                                                                    |
| Dynamic import            | `src/lib/capture.mjs` (the project's own Playwright), `src/dashboard.mjs` (a custom dashboard adapter the project names) | Paths resolved from the project's install or its config, never from the network                                                                                                                                                     |
| Code evaluated at runtime | none in pxsig's code                                                                                                     | axe-core's own bundle is added to the rendered page with Playwright's `addScriptTag`; token overrides in the research tools are fixed transforms, not code                                                                          |
| Native binaries           | `@pxsig/cli-<platform>-<arch>`, the Rust engine                                                                          | Built by the release workflow from this repository, with checksums and provenance attestations ([Verifying a download](#verifying-a-download))                                                                                      |
| Bundled web page          | `dist/dashboard/assets/app.js`, the dashboard                                                                            | Unminified, so it reads as code; built locally from the design system and attached to the release (docs/releasing.md)                                                                                                               |
| Install scripts           | none                                                                                                                     | The published `package.json` files carry no `scripts` (`scripts/pack-manifest.mjs`)                                                                                                                                                 |

## Baselines

`.psig` files are not encrypted. The header reserves an `encryption` field, but encryption is not
implemented. Anyone who can read the repository can read the baseline images.
