# pxsig quick start

From nothing to a reviewed first baseline, then CI. Run the commands in the package that has the
stories; Storybook must be running (or built: `storybook.staticDir`). Each step links to the full
documentation.

## 1. Install

```bash
pnpm add -D pxsig playwright          # or: npm install -D pxsig playwright
pnpm exec playwright install chromium
```

Node.js 22 or later. Optional: `pnpm add -D @pxsig/storybook-addon` for the Storybook panel
([docs/storybook.md](docs/storybook.md)).

## 2. Set up and check

```bash
pnpm exec pxsig init                  # writes pxsig.config.json and the .pxsig/ store
pnpm exec pxsig manifest              # every story × mode × state, from the running Storybook
pnpm exec pxsig check --full          # renders them; the first run marks every entry NEW (exit 1)
```

Configuration: [docs/configuration.md](docs/configuration.md).

## 3. Open the dashboard

```bash
pnpm exec pxsig serve
```

Started by a person at a terminal, `pxsig serve` prints two addresses: the dashboard, and the
**dashboard link**, which carries a one-time ticket. Approving and rejecting work only in a
browser that opened the link.

- **5 minutes to access the link; it works once.** Once opened, that browser can approve, with no
  time limit, until `pxsig serve` stops or the browser closes.
- **A new link** from the running server, in the same folder: `pnpm exec pxsig serve --link`.
  `--open` also opens it in the browser (on Windows nothing is started); `--copy` also copies it
  to the clipboard (opt-in: any program on the computer can read the clipboard).
- **Why a link:** pxsig prints it only to a person at a terminal, never to an assistant, a script
  or CI. Those can read the dashboard and the clipboard, so a decision stays a person's.

The top bar shows where the page stands:

| Badge           | Meaning                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `Live`          | connected to `pxsig serve`; the page updates as checks run                                                     |
| `Static report` | a saved report opened from disk; nothing is decided there                                                      |
| `Offline`       | the server stopped or cannot be reached; the page keeps the last data it had                                   |
| `Can approve`   | this browser opened the dashboard link                                                                         |
| `Read only`     | it did not: Approve and Reject stay in place, disabled; pointing at the badge shows the command for a new link |

The title beside the pxsig mark names what is under review (its `label` in the pxsig config, else
the project name). The dashboard's Help page explains the same at its top, and every other part of
the screen below it. Details: [docs/server.md](docs/server.md#guards).

## 4. Review, one entry at a time

Open an entry from the Overview or Review, compare the baseline and the latest render (side by
side, swipe, onion skin, pixel diff, heat map), then **Approve** (`A`) or **Reject** (`R`). Each
decision covers that one entry: one story in one mode and state. Every approval is logged with
the file's hash before and after, and can be undone.

```bash
pnpm exec pxsig doctor                # confirms nothing is left uncovered
git add pxsig.config.json .pxsig      # the store's own .gitignore keeps renders and diffs out
```

## 5. CI

```bash
pnpm exec pxsig check --full --since origin/main   # the entries the branch's changes affect
pnpm exec pxsig doctor --ci                         # fails on error-severity coverage problems
```

CI never approves: a changed entry fails the job, and a person reviews it in the dashboard. Full
workflows for GitHub Actions and others: [docs/ci.md](docs/ci.md).

## Next

- Monorepos and several Storybooks: [docs/monorepo.md](docs/monorepo.md)
- Coding assistants (MCP, read-only): [docs/agents.md](docs/agents.md)
- Upgrading from an earlier version: [docs/migrating.md](docs/migrating.md)
- Every command: [docs/cli.md](docs/cli.md)
