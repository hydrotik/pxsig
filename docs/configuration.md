# Configuration

pxsig reads two files:

- `pxsig.workspace.json` at the repository root lists the projects in a monorepo. A single-package
  repository does not need one.
- `pxsig.config.json` in each project (package under test) configures that project.

Both have JSON Schemas in the `pxsig` package: `node_modules/pxsig/schema/workspace.json` and
`node_modules/pxsig/schema/project.json`. Point `$schema` at them for editor completion.

Run `pxsig config [--project name]` to print the resolved configuration of a project, with the
layer that set each key.

## Layers

A value comes from the first layer that sets it:

1. **Story parameters**: `parameters.pxsig` in the story file, per entry (gate, grid, modes,
   states, …). See [Story parameters](#story-parameters).
2. **CLI flags** for one run.
3. **Environment variables** (`PXSIG_*`, below).
4. The project's **`pxsig.config.json`**.
5. The workspace file's **`defaults`**.
6. **Built-in defaults** (listed with each key below). They name no repository and no path outside
   the project.

Objects merge key by key across layers. Arrays and other values replace. **Modes are the
exception**: a project's `modes` replace the workspace's (or the built-in) set entirely, because
modes are a set, not settings.

The CLI flags layer is the config flags every command accepts:

| Flag | Key |
| --- | --- |
| `--storybook-url <url>` | `storybook.url` |
| `--storybook-static <dir>` | `storybook.staticDir` |
| `--storybook-config <dir>` | `storybook.configDir` |
| `--grid <n>` | `grid` |
| `--min-cell-px <n>` | `minCellPx` |
| `--settle-ms <n>` | `capture.settleMs` |
| `--browser <ws://…>` | `capture.browserEndpoint` |

Other flags (`--modes`, `--only`, `--concurrency`, …) are run options, not config. `pxsig config`
names the layer behind every key: `defaults`, `workspace defaults`, `project config`, `env` or
`flags`.

For gate values the same order holds inside the engine: a story's `parameters.pxsig.gate` beats
the binary's gate flags, which beat the `PXSIG_*` gate variables, which beat the project's `gate`
(see [spec.md](spec.md#gate-resolution)).

## Paths

- A relative path in `pxsig.config.json` is relative to the project folder.
- A path that starts with `$workspace/` is relative to the workspace root.
- A path in the workspace file's `defaults` is relative to the workspace root (the folder of
  `pxsig.workspace.json`), like every path in that file. `$workspace/` works there too.
- A path given as a CLI flag is relative to the current folder.
- Absolute paths are used as they are.

## `pxsig.workspace.json`

```json
{
  "$schema": "./node_modules/pxsig/schema/workspace.json",
  "version": 1,
  "projects": {
    "ui": "packages/ui",
    "charts": "packages/charts"
  },
  "defaults": {
    "storybook": { "url": "http://localhost:6006", "configDir": "$workspace/apps/storybook/.storybook" },
    "grid": 64
  },
  "server": { "port": 6070 }
}
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `version` | integer | `1` | File format version. |
| `projects` | object | required | Project name to project folder, relative to the workspace root. Each folder holds a `pxsig.config.json`. |
| `defaults` | object | `{}` | Any project config key. Applied under each project's own config. |
| `server.port` | integer | `6070` | Port `pxsig serve` tries first. If it is taken, the next ten ports are tried. |
| `requires` | string | none | The pxsig versions this workspace needs, as a range: `">=0.4.0"`, `">=0.4.0 <0.6.0"`, alternatives joined by `\|\|`. A pxsig outside it refuses to run here (exit 2, naming the range), and `doctor` warns about installs outside it (`version-required`). pxsig 0.3.x does not read the key, so it cannot stop an older install. |

In a monorepo the project's name is its key in `projects`. `pxsig init <dir>` adds the entry.

## `pxsig.config.json`

The smallest config is `{}`: every key has a default. `pxsig init` writes
`{ "version": 1, "srcRoot": "src" }`, plus `name` and `storybook` when given.

```json
{
  "$schema": "../../node_modules/pxsig/schema/project.json",
  "version": 1,
  "srcRoot": "src",
  "storybook": {
    "url": "http://localhost:6006",
    "configDir": "$workspace/apps/storybook/.storybook"
  },
  "capture": {
    "viewport": [900, 600],
    "waitFor": [{ "selector": ".chart-root", "minMs": 1500, "stableMarkup": ".chart-root svg" }]
  },
  "modes": {
    "light": { "globals": "theme:light", "colorScheme": "light" },
    "dark": { "globals": "theme:dark", "colorScheme": "dark" },
    "mobile": { "extends": "light", "viewport": [390, 844] },
    "firefox": { "extends": "light", "browser": "firefox" }
  },
  "defaultMode": "light",
  "modesByDefault": ["light", "dark"],
  "suites": { "matrix": { "modes": ["mobile", "firefox"] } },
  "nonVisual": ["hooks", "utils"]
}
```

### Keys

| Key | Default | Meaning |
| --- | --- | --- |
| `version` | `1` | File format version. |
| `name` | package name | Project name in a single-package repository: this key, else the `name` in `package.json` without its scope, else `default`. In a monorepo the workspace key is the name. |
| `label` | the project name | The dashboard title after "pxsig ·": what this project reviews, in your words (`"Hydrotik"`). 1 to 60 characters; anything else stops the project from loading with a setup error. `pxsig init` asks for it at a terminal or takes `--label`; afterwards, edit this file. `--project` and reports still use the name. |
| `srcRoot` | `"src"` | The folder whose stories belong to this project. A story's component is its folder relative to `srcRoot`. |
| `storybook.url` | `"http://localhost:6006"` | Where Storybook serves `index.json` and `iframe.html`. A dev server or a static build. |
| `storybook.configDir` | `null` | Storybook's config folder. `index.json` gives story paths relative to the folder Storybook runs in (the parent of `configDir`); pxsig uses this to resolve them. Set it when Storybook lives outside the project. |
| `storybook.staticDir` | `null` | A built Storybook (`storybook build` output: `index.json` + `iframe.html`). When nothing answers at `storybook.url`, `check --full`, `manifest` and the server serve this folder themselves on a free 127.0.0.1 port and render against it. A Storybook that answers with a broken index is not replaced. |
| `store.dir` | `".pxsig"` | The store folder (see [monorepo.md](monorepo.md#store-layout)). |
| `store.layout` | `"package"` | `package`: baselines in `<store>/baselines/<component>/<id>.psig`. `colocated`: baselines in `<srcRoot>/<component>/__pxsig__/<id>.psig`. |
| `capture.viewport` | `[900, 600]` | Browser viewport, `[width, height]` in CSS pixels, at device scale 1. |
| `capture.settleMs` | `200` | Minimum wait after fonts load, before the layout-stability wait. |
| `capture.target` | `"#storybook-root"` | The element captured. A story can override it. |
| `capture.waitFor` | `[]` | Extra waits for content that animates in script: `{ selector, minMs?, stableMarkup? }`. A rule applies when its `selector` matches. `minMs` raises the minimum wait; `stableMarkup` waits until the markup under that selector stops changing. |
| `capture.browserEndpoint` | `null` | A Playwright browser server (`ws://…`) to render with instead of launching a browser on this machine: usually the container's, from `pxsig browser start` ([container.md](container.md)). Every engine (Chromium, Firefox, WebKit) connects to it; Storybook on this machine's localhost stays reachable. The project's Playwright must be the server's major.minor. Also `--browser` and `PXSIG_BROWSER_WS`. |
| `grid` | `64` | Signature grid, cells per side (8..256). |
| `minCellPx` | `8` | Adaptive grid: cells at least this many pixels wide, capped by `grid` (see [spec.md](spec.md#2-signature-construction)). |
| `detail` | `true` | Write the detail channel into new baselines. |
| `trim` | `{ "pad": 16, "tolerance": 8 }` | Crop renders to their content (right and bottom) before checking. `pad` pixels are kept around the content; a pixel is content when it differs from the bottom-right pixel by more than `tolerance`. `false` turns trimming off. |
| `gate` | see below | The gate for every entry. |
| `modes` | `{ "default": { "globals": "", "colorScheme": "light" } }` | Named render settings (below). |
| `defaultMode` | first key of `modes` | The mode whose entries keep the bare story id. |
| `modesByDefault` | `[defaultMode]` | Modes every story is rendered in, unless the story says otherwise. |
| `suites` | `{}` | Extra manifests for other mode sets (below). |
| `affects.workspaceDeps` | `true` | A change in the source of a workspace package this project depends on (runtime and peer dependencies with a `workspace:` range) selects every entry. |
| `affects.extra` | `[]` | More paths whose change selects every entry (for example the Storybook config folder, a lockfile). |
| `affects.ignore` | `[]` | Globs for changed paths that select nothing when nothing traced claims them: docs, other apps, CI config ([ci.md](ci.md#how-selection-decides)). Anchored like `affects.extra` (the project folder; `$workspace/` for the workspace root), plus `$repo/` for paths outside the workspace. `*` within a folder, `**` any depth, `?`, `{a,b}`; a trailing `/` matches a folder's contents. Never hides a baseline, a store file, an "affects every entry" path or a module a story imports. Not replaced by `PXSIG_SOURCES`. |
| `affects.aliases` | `{}` | Import aliases only a bundler knows (Vite `resolve.alias`): specifier prefix → path, anchored like `affects.extra`; the longest prefix wins. `{ "@acme/ui": "src" }` makes `@acme/ui/Button` the file `src/Button`. Without it such an import is unresolved ([ci.md](ci.md#what-counts-as-an-import)). |
| `affects.unresolved` | `[]` | Globs of files whose unresolved imports are accepted (a `virtual:` module, a computed `import()`), anchored like `affects.ignore`. Without it, an unresolved import adds the entries that reach its file to every `check --since` run, and every entry when the file affects every entry. |
| `nonVisual` | `[]` | Top-level folders under `srcRoot` with no visual stories. Their stories are not entries and are reported as `excluded`. |
| `a11y` | `true` | Run axe on every render. |
| `env` | `{}` | The render environment each baseline records and each check compares (below). |
| `env.ignore` | `[]` | Environment fields left out of the comparison, by name, for example `["render.timezone"]` when no story formats a date. |
| `env.fontProbe` | `[]` | Font families measured besides `serif`, `sans-serif`, `monospace` and `system-ui`, so a font difference names the family. The probe page loads no stylesheet, so this measures fonts installed on the machine (a family that is not installed measures as the fallback); a web font the stories load from the repository is part of the story, not the environment. |
| `env.strict` | `false` | Refuse a check (exit 2, nothing rendered) when a selected baseline was approved in a different environment. Same as `check --strict-env` and `PXSIG_STRICT_ENV=1`. |
| `enforcement` | `{}` | Warn mode: per gate, `enforce` or `warn` (below). |
| `integrity` | `{}` | Integrity options (below). |
| `approvals.identity` | `none` | What each approval and repair log line says about who made it. `none`: nothing; the commit that adds the line and the pull request say who, and pxsig writes no personal data. `git-email`: the git email in a `by` field, as before 0.4.0. |
| `approvals.level` | `standard` | `standard`: a typed phrase at a terminal, or the dashboard opened with the dashboard link. `strict` is reserved for a later release and refused for now (a setup error). |
| `dashboard.ui` | none | A UI adapter for `pxsig dashboard build` and `gaps`: a path to its module, relative to this folder, or a built-in adapter's name (see [ui/build-adapter.md](ui/build-adapter.md)). `pxsig serve` then serves this project's build while it is current. |

### `gate`

| Key | Default | Meaning |
| --- | --- | --- |
| `threshold` | `24` | Per-cell mean RGB delta that counts a cell as changed. |
| `minCells` | `3` | Fail when at least this many cells changed. `0` turns the rule off. |
| `minSsim` | `0.99` | Fail when SSIM is below this. |
| `maxChangedPct` | `2` | Fail when more than this percentage of cells changed. |
| `maxEdgePct` | off | Fail when the edge-map difference is above this percentage. |
| `detail` | `{ "blockDelta": 32, "energyDelta": 48, "minTiles": 3 }` | Detail-channel rule, or `false` to turn it off. |

The metrics are defined in [spec.md](spec.md#4-metrics-and-gate).

### `modes`

A mode is a set of render settings. Every story is rendered once per mode it uses.

| Key | Meaning |
| --- | --- |
| `globals` | Storybook globals for the render, in URL form: `"theme:dark;density:compact"`. |
| `colorScheme` | `light` or `dark`, emulated by the browser (`prefers-color-scheme`). |
| `viewport` | `[width, height]`, overrides `capture.viewport`. |
| `browser` | `chromium` (default), `firefox` or `webkit`. Each needs its Playwright browser installed. |
| `extends` | Another mode's name. Its resolved keys are copied first, then this mode's. Chains of any length resolve (`mobile` extends `brand` extends `dark`); a cycle or an unknown name is a setup error that names the chain. |

A story renders in `modesByDefault`, plus its `addModes`, or exactly its `modes` when it sets them.

### `suites`

A suite is a second manifest for a different set of modes, for example a cross-browser matrix
that runs less often.

```json
{ "suites": { "matrix": { "modes": ["mobile", "firefox"] } } }
```

`pxsig manifest --suite matrix` writes `<store>/manifest.matrix.json` with each story in exactly
those modes (a story's own `modes` list still narrows it). `pxsig check --suite matrix` checks it
and writes `check-matrix.json`, `summary-matrix.md` and `junit-matrix.xml`. Every mode a suite
names must exist in `modes`. `addModes` is accepted as another name for `modes`.

### `env`

Every render records the environment that produced it, and every baseline written from a render
keeps that render's environment in its `.psig` header (`env`, [spec.md](spec.md#header)). A
check compares each render's environment with its baseline's:

| Result | When | Effect |
| --- | --- | --- |
| `same` | every field equal | none |
| `compatible` | only minor fields differ | listed in `check.json` (`envDiff`); no warning |
| `mismatch` | a major field differs | the `env-mismatch` warning: one line in `check`, a line in `summary.md`, a setup finding in `pxsig doctor` and the dashboard's coverage banner. With `env.strict`, `--strict-env` or `PXSIG_STRICT_ENV=1`, the check refuses before rendering (exit 2). |
| `unknown` | the baseline records no environment (written before 0.5) | none, ever |

| Field | Tier | What |
| --- | --- | --- |
| `browser.name`, `browser.channel`, `browser.launchArgs` | major | the Playwright browser, the channel it launched with (`chrome`, `msedge` when the bundled browser is missing), pxsig's launch arguments |
| `browser.version` | major on the first number, minor on the rest | the full browser build |
| `playwright` | minor | the Playwright version pxsig resolved |
| `os.platform`, `os.arch` | major | `darwin`, `linux`, `win32`; `arm64`, `x64` |
| `os.release`, `os.distro` | minor | the kernel release; the Linux distribution, else the OS version string (on macOS without the kernel build) |
| `fonts.probe` | major | a digest of canvas text widths at three sizes for each probed family, with one 8-character digest per family so a difference names it |
| `fonts.system` | minor | a digest of the installed font list where `fc-list` exists (Linux, the container), else `null` |
| `render.dpr`, `render.reducedMotion` | major | the capture settings (1, `reduce`) |
| `render.gpu` | major | a class (`swiftshader`, `angle-metal`, `angle-gl`, `angle-vulkan`, `masked`, `none`), never the renderer string |
| `render.colorGamut`, `render.timezone`, `render.locale` | major | what the probe page reports |
| `capture.pipeline` | major | a number pxsig bumps when its capture code changes how renders look |
| `container.image`, `container.revision`, `container.digest` | minor | `PXSIG_IMAGE`, `PXSIG_IMAGE_REVISION`, `PXSIG_IMAGE_DIGEST` when set |
| `pxsig`, `engine`, `node` | minor | the versions that rendered |

`id` is the first 16 hex characters of a sha256 over the major fields. Nothing in `env` names the
machine or a person: no host name, user name, GPU model or font list.

The environment is collected once per browser in a check (one probe page that is not a story),
and once per browser launch in `pxsig serve`. Approving in the dashboard writes the environment
of the render being approved, from the check that made it.

### `enforcement`

Warn mode. Each gate is `enforce` (a failure fails the run, as before) or `warn` (the same checks
on the same selection; the failure is reported and the run exits `advisoryExit`). Warn is never a
pass: every surface says which gates were warned and what would have failed.

```json
"enforcement": {
  "default": "enforce",
  "gates": { "visual": "warn", "doctor": "warn" },
  "warnUntil": "2026-12-31",
  "noticeDays": 14,
  "advisoryExit": 0
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `default` | `enforce` | Every gate not named in `gates`, except `a11y`, which keeps its own default. |
| `gates`: `visual` | `enforce` | `check`: rows not passing (changed, new, render errors). |
| `gates`: `a11y` | `warn` | New axe violations against each entry's accepted list (`a11y.json`). On its default `warn` it is quiet: nothing is printed unless a new violation appears, then one ADVISORY line and a `summary.md` lead, exit 0. `enforce`: a new violation fails the run (exit 1). `off`: no a11y gate and no line. |
| `gates`: `verify` | `enforce` | `approve verify`: baselines with no log line. A mismatch, an interrupted approval or a rewritten log fails in every mode. |
| `gates`: `env` | `enforce` | `--strict-env`'s refusal: on `warn` the check renders anyway and lists the baselines it would have refused. |
| `gates`: `doctor` | `enforce` | `pxsig doctor` findings at or above `--fail-on`. A setup error still exits 2. |
| `gates`: `stale` | `enforce` | `pxsig stale`: stale or inconsistent verdicts. |
| `warnUntil` | none | `YYYY-MM-DD`, the end of that day in UTC. After it the gates set to `warn` here are enforced, with no commit. Extending it is a one-line change in a pull request. |
| `noticeDays` | `14` | From this many days before `warnUntil`, every run, `summary.md`, `pxsig status` and `pxsig doctor` (`enforcement-ending`) say when warn mode ends. |
| `advisoryExit` | `0` | The exit code of a run that would have failed only in gates on warn: `0`, or `10` to `125` for a forge's own warning state (GitLab `allow_failure: exit_codes`, Jenkins `UNSTABLE`). `1`, `2` and `3` are refused. |

An unknown gate name or value is a setup error when the project loads. The workspace file's
`defaults` can set `enforcement` for every project; a project's own key wins.

**Who can lower a gate.** Only this committed config (reviewed in a pull request), or `--warn` from
a person at a terminal for one run (refused with exit 3 in CI, under an assistant, or piped).
`--enforce[=gates]` and `PXSIG_ENFORCEMENT=enforce` raise gates, for anyone: CI variables and
assistants can only make a run stricter; `PXSIG_ENFORCEMENT=warn` is refused (exit 2). No MCP tool
changes a gate. `pxsig config` lists each gate with the layer that set it.

**What a warn run shows.**
- The first line of `check`, `approve verify`, `doctor` and `stale`: `[pxsig] ADVISORY: warn mode
  for visual, doctor (pxsig.config.json; until 2026-12-31). Failures are reported; the exit stays 0.`
- The last line: `[pxsig] ADVISORY: would have failed (exit 1): 3 changed, 1 new. Not blocking.
  Would-fail runs: 4 of 31 (main 0 of 9).` or `ADVISORY: would have passed.`
- `check.json`: `enforcement` (`gates`, `layers`, `warnUntil`, `wouldFail`, `wouldExit`, `exit`,
  `reasons`, and `contexts: { enforce, advisory }`, the gates each status context carries) and
  `git.head`. Rows are unchanged.
- `summary.md`: a lead block above the head, for example `> **ADVISORY: warn mode** (visual). This
  run would have failed: 3 changed. Nothing was blocked. Enforced from 2026-12-31.` The head and
  table below stay as they are.
- `junit.xml`: failures stay failures; with the visual gate on warn the suite carries `<property
  name="pxsig.enforcement" value="warn"/>`. A JUnit consumer that fails on failures needs its own
  switch (`dorny/test-reporter` `fail-on-error: false`; Jenkins `junit` reports `UNSTABLE`).
- `history.ndjson`: the run's line gains `enforcement` and `wouldFail`.
- `pxsig doctor` and the dashboard's coverage banner: `enforcement-warn` (info), `enforcement-ending`
  (warn), `enforcement-expired` (info). None changes `doctor`'s exit.
- MCP: `pxsig_status.enforcement` (gates, `warnUntil`, the readiness tally), `pxsig_check`'s
  `enforcement` and `wouldFail`, `pxsig_history`'s `wouldFail`.

The quiet a11y default writes none of these unless a new violation appears, and never a readiness
line.

**The readiness tally.** Every run with a gate on `warn` here appends one line to
`readiness.ndjson` in the repository's state folder, outside the repository (macOS
`~/Library/Application Support/pxsig/<repo-key>/`, Linux `$XDG_STATE_HOME/pxsig/<repo-key>/`,
Windows `%LOCALAPPDATA%\pxsig\<repo-key>\`; every worktree of a clone shares one):
`{ at, project, suite, sha, branch, gates, wouldFail, wouldExit, counts, source }`. It keeps 90 days
and at most 5,000 lines per project and gate set. The count of would-fail runs, on `main` apart, is
the evidence for switching a gate to `enforce`. A failed write is one warning on stderr and never
changes the exit.

### `integrity`

| Key | Default | Meaning |
| --- | --- | --- |
| `requireBaselineImages` | `true` | Report `missing-baseline-image` when a baseline has no image. A spec v1 `.pxsig.json` baseline never has one. |
| `staleAfterSourceChange` | `true` | Report `stale` when a source changed after a verdict. |
| `sourceRoots` | `null` | Folders, relative to the workspace root, whose edits can make a verdict stale. Default: `srcRoot`. |
| `maxTracedFiles` | `400` | Above this many edited files, staleness falls back to "same component folder" instead of the import graph. |
| `severity` | `{}` | Per-code severity override, for example `{ "unbaselined": "error" }`. |
| `indexTimeoutMs` | `4000` | Timeout for fetching Storybook's `index.json`. |
| `renderSkewMs` | `5000` | A render written this long after its verdict makes the verdict stale. |
| `manifests` | suite manifests | Other manifests, relative to the store, whose baselines are not orphans. Default: every `manifest.<suite>.json` beside `manifest.json`. |

### Advanced

| Key | Meaning |
| --- | --- |
| `importPathPattern` | A regular expression that decides which story files belong to the project, with the component folder as capture group 1. Default: files under `srcRoot`. |

## Environment variables

| Variable | Read by | Meaning |
| --- | --- | --- |
| `PXSIG_WORKSPACE` | CLI, MCP, server | The workspace root. Skips the walk up from the current folder. |
| `PXSIG_ROOT` | CLI, MCP, server | Older name for `PXSIG_WORKSPACE`. Kept for 0.2. |
| `PXSIG_PROJECT` | CLI, MCP | The project, when `--project` is not given. |
| `PXSIG_BIN` | CLI, MCP, server | Path to the `pxsig` binary, for example a local `target/release/pxsig`. |
| `PXSIG_URL` | CLI, MCP | The server URL. Overrides `server.json` and `server.port`. |
| `PXSIG_STORYBOOK_URL` | CLI, MCP, server | Overrides `storybook.url`. |
| `PXSIG_GRID` | CLI, MCP, server, binary | Overrides `grid`. |
| `PXSIG_SOURCES` | CLI, MCP, server | Comma-separated workspace-relative paths whose change selects every entry. Replaces `affects` (workspace dependencies are not added), and replaces the staleness source roots. |
| `PXSIG_FORMAT` | CLI | Output format: `pretty`, `plain` or `json`. |
| `PXSIG_DASHBOARD_DIR` | server, `report` | A dashboard folder to serve or write instead of the prebuilt one, above `dashboard.ui`'s build. |
| `PXSIG_UI_ADAPTER` | dashboard build | The UI adapter, by built-in name or path; above `dashboard.ui`. |
| `PXSIG_AGENT` | CLI, MCP, server | Marks the shell as a coding assistant's, for one that sets no marker of its own: plain output, commands that need a person are refused, and log lines carry `agent` (the value, or `agent` for `1`). The other markers are in [agents.md](agents.md#markers). |
| `PXSIG_NO_DELEGATE` | CLI | Do not hand over to the workspace root's install (see [monorepo.md](monorepo.md#installs)). |
| `PXSIG_THREADS` | binary | Worker threads for batch commands. Default: logical CPUs. |
| `PXSIG_THRESHOLD`, `PXSIG_MIN_SSIM`, `PXSIG_MAX_CHANGED_PCT`, `PXSIG_MAX_EDGE_PCT`, `PXSIG_MIN_CELLS` | binary | Gate values above the project's `gate` and below the gate flags and every story's own gate (see [spec.md](spec.md#gate-resolution)). |
| `PXSIG_ENFORCEMENT` | CLI | `enforce`: every gate enforced for this run, whatever the config says ([enforcement](#enforcement)). `warn` is refused (exit 2): warn mode comes from the committed config or `--warn` at a terminal. |
| `PXSIG_STRICT_ENV` | CLI | `1`: `check --full` refuses when a selected baseline was approved in a different render environment, like `--strict-env` ([env](#env)). |
| `PXSIG_IMAGE`, `PXSIG_IMAGE_REVISION`, `PXSIG_IMAGE_DIGEST` | CLI, server | Recorded in each render's environment (`container.*`); the pxsig container image sets the first two, a runner may set the digest. |
| `PXSIG_BROWSER_WS` | CLI, server | Overrides `capture.browserEndpoint`: render with that browser server ([container.md](container.md)). |
| `PXSIG_PLAYWRIGHT` | CLI, server | A Playwright package folder to load before the project's. The container image sets it to its own (`/opt/pxsig/node_modules/playwright`), so the driver always matches the browsers installed beside it. Unset, Playwright resolves from the project as before. |
| `PXSIG_DEBUG` | CLI, MCP, server | `spawn`: print every program pxsig starts, with its arguments, on stderr ([platforms.md](platforms.md#programs-pxsig-starts)). `pxsig serve --debug` sets it. |
| `NO_COLOR`, `FORCE_COLOR` | CLI | Colour in terminal output. |

## Story parameters

Per-story settings live in the story file, on a story or on its meta, under `parameters.pxsig`.
pxsig reads them from the running Storybook, so they are exactly what the story declares.
`pxsig manifest` copies them into the manifest; edit a story, then run `pxsig manifest` again.

```ts
export const Menu = {
  parameters: {
    pxsig: {
      modes: ['light', 'dark', 'mobile'],
      gate: { threshold: 32, detail: { minTiles: 4 } },
      ignore: ['[data-timestamp]'],
      states: [
        { name: 'hover', action: 'hover', target: 'button' },
        { name: 'open', action: 'click', target: '[aria-haspopup]', waitFor: '[role="menu"]', fullPage: true },
      ],
      delay: 400,
    },
  },
};
```

| Key | Meaning |
| --- | --- |
| `disable` | `true` leaves the story out. The tag `no-pxsig` does the same. |
| `modes` | Render in exactly these modes. |
| `addModes` | Render in `modesByDefault` plus these. |
| `gate` | Gate overrides for this story's entries (same keys as `gate`). |
| `grid` | Signature grid for this story. Turns the adaptive grid off. |
| `detail` | `false`: no detail channel in this story's baselines. |
| `viewport` | `[width, height]`, overrides the mode's and the project's viewport. |
| `ignore` | CSS selectors masked before every capture. |
| `states` | Extra captures after an interaction, one entry each (below). |
| `delay` | Extra settle time, in ms. |
| `target` | The element to capture, instead of `capture.target`. |
| `a11y` | `false` skips the axe pass. |

Each item in `states`:

| Key | Meaning |
| --- | --- |
| `name` | State name; the entry id gets `__<name>`. Lowercase letters, digits and hyphens. |
| `action` | `hover`, `focus`, `click`, `rightclick` or `press`. |
| `target` | Selector of the element to act on. Default: the first element inside `capture.target`. |
| `key` | For `press`: a key name or an array of them. Default `Tab`. |
| `waitFor` | Selector to wait for after the action. |
| `fullPage` | Capture the viewport instead of the target, for popups rendered outside the story root. |

## Renders

Every render uses a fixed viewport at device scale 1, reduced motion, a stylesheet that turns
animations, transitions and carets off, a fixed `Math.random`, `document.fonts.ready`, and a wait
until the layout stops moving. Story ids and globals go in the iframe URL. Without a bundled
Chromium, pxsig tries the installed Chrome, then Edge.
