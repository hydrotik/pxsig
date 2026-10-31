# Workspaces, projects and stores

## Terms

| Term          | Meaning                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace** | The repository root: the folder that holds `pxsig.workspace.json`. Without one, the folder of the nearest `pxsig.config.json`.   |
| **Project**   | One package under test: one source root, one Storybook that renders it, one store. Its name is unique in the workspace.          |
| **Store**     | The project's pxsig data: manifest, baselines, approvals, a11y baseline, and the output of runs. `<project>/.pxsig/` by default. |

In a single-package repository the workspace and the project are the same folder, and there is no
workspace file.

## Registry and discovery

The workspace file is the registry: it maps each project name to its folder. It is committed, so
adding or removing a project is a reviewed change, and pxsig never has to guess which folders are
projects.

```json
{
  "version": 1,
  "projects": {
    "ui": "packages/ui",
    "charts": "packages/charts"
  }
}
```

Every surface finds the workspace the same way:

1. `--workspace <dir>` or `PXSIG_WORKSPACE` (or the older `PXSIG_ROOT`), when given.
2. Otherwise, walk up from the current folder to the first `pxsig.workspace.json`.
3. Without one, walk up to the first `pxsig.config.json`: a one-project workspace.

The walk stops at a folder that contains `.git`, so it never leaves the repository.

Then it picks a project:

1. the name or folder given (`--project`, the MCP `project` argument, `PXSIG_PROJECT`);
2. otherwise the project whose folder contains the current folder (the deepest one);
3. otherwise the only project, when there is one.

When several projects fit and none was named, the command stops with exit 2 and lists the names.

## Setting up

Single package:

```bash
cd my-design-system
npx pxsig init
```

Monorepo: create the workspace file first, then run `init` for each package. `init` adds the
entry to the workspace file. The workspace file, `pxsig.workspace.json` at the root, saved as UTF-8:

```json
{ "version": 1, "projects": {} }
```

```bash
npx pxsig init packages/ui --storybook-config '$workspace/apps/storybook/.storybook'
npx pxsig init packages/charts --name charts --storybook-config '$workspace/apps/storybook/.storybook'
```

`init` writes, when they do not exist yet:

- `<package>/pxsig.config.json`;
- `<store>/.gitignore` and `<store>/.gitattributes` (below);
- the project's entry in `pxsig.workspace.json`, when a workspace file exists above the package.

It never overwrites an existing config. `pxsig projects` lists the registered projects.

One Storybook can serve several projects. Each project owns the stories whose files are under
its `srcRoot`. Set `storybook.configDir` when Storybook runs from another folder, so pxsig can
resolve the story paths in its index.

## Installs

**One root install covers every project.** Add `pxsig` as a dev dependency of the workspace root.
Playwright is resolved like any dependency: from the project, then the workspace root, then
pxsig's own install. axe-core is pxsig's own dependency and is resolved from pxsig first, so a
project's axe-core never changes a11y results; the project's copy is used only when pxsig's cannot
be found (a copy of pxsig run without its dependencies installed). The version used is `axe` in
the render environment ([configuration.md](configuration.md#env)). Packages under test install
nothing; they hold a config and a store.

**A package may also install pxsig** when it is used outside the monorepo too (published or
checked out alone). Outside the monorepo its own config is a one-project workspace.

**Inside the monorepo the root install wins.** The `pxsig` command walks up to the workspace root
(the first folder with `pxsig.workspace.json` or `.git`). If that folder has its own
`node_modules/pxsig`, and it is not the copy already running, the command hands over to it. One
engine then writes and checks every baseline in the workspace. Set `PXSIG_NO_DELEGATE=1` to turn
the handover off.

**The engine binary.** The `pxsig` npm package finds the binary in a per-platform package
(`@pxsig/cli-<platform>-<arch>`, an optional dependency, see [releasing.md](releasing.md)).
`PXSIG_BIN` overrides that, for example with a local `cargo build --release`.

## Store layout

With the default `store.layout: "package"`:

```
packages/ui/
  pxsig.config.json                    committed
  .pxsig/
    .gitignore                         committed (written by init)
    .gitattributes                     committed (written by init)
    manifest.json                      committed: every entry and its baseline path
    manifest.<suite>.json              committed: one per suite
    baselines/<component>/<id>.psig    committed: signature + baseline image
    approvals.ndjson                   committed: every approval, with hashes before and after
    a11y.json                          committed: accepted axe violations per entry
    renders/latest/  renders/retry/    ignored: the latest renders
    diffs/                             ignored: diff images for failures
    reports/                           ignored: check.json, integrity.json, review.json, history.ndjson, junit.xml, summary.md,
                                       and .lock while a writer (a full check, the server, …) holds the store
    cache/                             ignored: the engine's content cache
    history/                           ignored: the baselines an approval replaced, for `approve undo`
    trash/                             ignored: files `doctor --repair --prune` moved aside
```

`<component>` is the story file's folder relative to `srcRoot`, so a baseline's path names its
component. Stories outside `srcRoot` go under `_`.

With `store.layout: "colocated"`, baselines live beside the stories, in
`<srcRoot>/<component>/__pxsig__/<id>.psig`. Everything else stays in the store.

The store's `.gitignore`:

```
renders/
diffs/
reports/
cache/
history/
trash/
```

`history/` is ignored. On the machine where a batch was approved, `pxsig approve undo` restores
from it; anywhere else it restores from git: each approval line records the git HEAD and the
sha256 of the baseline it replaced, and a file is restored from a commit only when its bytes hash
to exactly that value (see [cli.md](cli.md#pxsig-approve)).

**One writer per store.** Commands that write a store take `<store>/reports/.lock` (pid, start
time, host, command): `check --full`, `approve undo` and `verify --adopt`, `migrate --apply`,
`doctor --repair --apply`, and the server for every project it serves. A second writer is refused
with the holder's name, or, for a full check against a served project, queued on the server. A
lock whose process has exited (or whose pid now belongs to a newer process) is stale and taken
over; a lock from another host is never judged stale. The holder stamps a heartbeat into the lock
every 5 seconds and, before each batch of writes, checks the lock is still its own (a random
`nonce`); if not, it stops with "lock taken over by …: nothing more was written". A quiet
heartbeat alone never frees a lock whose process is alive (a laptop that slept, a long render):
after 10 minutes without one, a person running a writing command at a terminal is offered the lock
and types `TAKE OVER`; the old holder stops at its next write. Agents and CI get exit 3 instead.

The running server writes its address to `<workspace>/node_modules/.cache/pxsig/server.json`.
That file is never committed and never inside a package.

## Reviewing `.psig` changes in git

A `.psig` file is binary. The store's `.gitattributes`, written by `init`, marks it and names a
diff driver:

```
*.psig binary diff=psig
```

Tell git how to show that driver once per clone:

```bash
git config diff.psig.textconv "npx pxsig cat"
```

`git diff` and `git log -p` then show the header of each changed baseline: its entry, grid, hashes,
size and the sha256 of its sections, instead of "binary files differ". The dashboard shows the
images.

With the `colocated` layout the baselines are outside the store, so the store's `.gitattributes`
does not reach them. `pxsig init` (for a colocated project) and `pxsig migrate --apply` (into one)
therefore append the same line to the root `.gitattributes`, the workspace's, or the package's
when there is no workspace file, unless a line for `*.psig` is already there.

## How each surface picks a project

| Surface              | Workspace                                                | Project                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI `pxsig`          | the current folder, `--workspace`, `PXSIG_WORKSPACE`     | `--project <name or folder>`, `PXSIG_PROJECT`, else the rule above. Read commands with no project chosen in a multi-project workspace (or with `--all`) cover every project.                  |
| MCP server           | the folder the client starts it in, or `PXSIG_WORKSPACE` | the `project` argument on every tool; `pxsig_projects` lists them. Required when there are several.                                                                                           |
| Server and dashboard | the folder it starts in, or `--workspace`                | serves every project (or those in `--project a,b`). Files are under `/p/<project>/…`; API calls take `project`, or infer it from the entry or story id. The dashboard has a project switcher. |
| Storybook addon      | the preset walks up from Storybook's `configDir`         | the server works out which project owns each story                                                                                                                                            |

The CLI and the MCP server find a running server through `PXSIG_URL`, else `server.json`, else
`server.port` in the workspace file, else port 6070, and use it only when its status answer names
this workspace ([server.md](server.md#reading)). The addon's order is in
[storybook.md](storybook.md#finding-the-server).

## Keeping the registry honest

The workspace file can drift from the folders: a package can gain a `pxsig.config.json` that no
entry lists, or an entry can point at a folder that is gone.

- An entry whose folder or config is missing makes every command for that project fail with a
  setup error (exit 2): `project "<name>": no pxsig.config.json at <path>`. `pxsig projects` shows
  the error on that project's row.
- The doctor codes `project-unlisted` (a config no entry points at) and `project-missing` (an entry
  without a config, an error) appear in the ledger's `setup` list, with `version-skew` (a pxsig
  install in the workspace on another major version).
