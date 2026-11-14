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
modes are a set, not settings. `capture.addIgnore` adds selectors to the `capture.ignore` list a
project inherits, where `capture.ignore` replaces it ([masks](#masks)).

The CLI flags layer is the config flags every command accepts:

| Flag                       | Key                       |
| -------------------------- | ------------------------- |
| `--storybook-url <url>`    | `storybook.url`           |
| `--storybook-static <dir>` | `storybook.staticDir`     |
| `--storybook-config <dir>` | `storybook.configDir`     |
| `--grid <n>`               | `grid`                    |
| `--min-cell-px <n>`        | `minCellPx`               |
| `--settle-ms <n>`          | `capture.settleMs`        |
| `--browser <ws://…>`       | `capture.browserEndpoint` |

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
    "storybook": {
      "url": "http://localhost:6006",
      "configDir": "$workspace/apps/storybook/.storybook"
    },
    "grid": 64
  },
  "server": { "port": 6070 }
}
```

| Key           | Type    | Default  | Meaning                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`     | integer | `1`      | File format version.                                                                                                                                                                                                                                                                                                              |
| `projects`    | object  | required | Project name to project folder, relative to the workspace root. Each folder holds a `pxsig.config.json`.                                                                                                                                                                                                                          |
| `defaults`    | object  | `{}`     | Any project config key. Applied under each project's own config.                                                                                                                                                                                                                                                                  |
| `server.port` | integer | `6070`   | Port `pxsig serve` tries first. If it is taken, the next ten ports are tried.                                                                                                                                                                                                                                                     |
| `label`       | string  | none     | The application this workspace is, as the dashboard names it after "pxsig •" (`"hydrotik ds"`). 1 to 60 characters. See [the title](#the-dashboard-title).                                                                                                                                                                        |
| `requires`    | string  | none     | The pxsig versions this workspace needs, as a range: `">=0.4.0"`, `">=0.4.0 <0.6.0"`, alternatives joined by `\|\|`. A pxsig outside it refuses to run here (exit 2, naming the range), and `doctor` warns about installs outside it (`version-required`). pxsig 0.3.x does not read the key, so it cannot stop an older install. |

In a monorepo the project's name is its key in `projects`. `pxsig init <dir>` adds the entry.

### The dashboard title

The dashboard's top bar and the browser tab name the application under review: `pxsig • <scope>`,
so the dashboard of one workspace is never taken for another's. The scope is, in order:

1. `label` in `pxsig.workspace.json`: the whole workspace (`"hydrotik ds"`), whichever project is
   shown;
2. else `label` in the project's `pxsig.config.json`;
3. else the project's name.

The folder's name is never used: a worktree or a checkout under another name would show a
different title for the same application. `pxsig config` prints the title.

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

| Key                       | Default                                                    | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                 | `1`                                                        | File format version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `name`                    | package name                                               | Project name in a single-package repository: this key, else the `name` in `package.json` without its scope, else `default`. In a monorepo the workspace key is the name.                                                                                                                                                                                                                                                                                                                                                   |
| `label`                   | the project name                                           | What this project reviews, in your words (`"Hydrotik"`): the project switcher's option, and the dashboard title after "pxsig •" when the workspace has no `label` ([the title](#the-dashboard-title)). 1 to 60 characters; anything else stops the project from loading with a setup error. `pxsig init` asks for it at a terminal or takes `--label`; afterwards, edit this file. `--project` and reports still use the name.                                                                                             |
| `srcRoot`                 | `"src"`                                                    | The folder whose stories belong to this project. A story's component is its folder relative to `srcRoot`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `storybook.url`           | `"http://localhost:6006"`                                  | Where Storybook serves `index.json` and `iframe.html`. A dev server or a static build.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `storybook.configDir`     | `null`                                                     | Storybook's config folder. `index.json` gives story paths relative to the folder Storybook runs in (the parent of `configDir`); pxsig uses this to resolve them. Set it when Storybook lives outside the project.                                                                                                                                                                                                                                                                                                          |
| `storybook.staticDir`     | `null`                                                     | A built Storybook (`storybook build` output: `index.json` + `iframe.html`). When nothing answers at `storybook.url`, `check --full`, `manifest` and the server serve this folder themselves on a free 127.0.0.1 port and render against it. A Storybook that answers with a broken index is not replaced.                                                                                                                                                                                                                  |
| `store.dir`               | `".pxsig"`                                                 | The store folder (see [monorepo.md](monorepo.md#store-layout)).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `store.layout`            | `"package"`                                                | `package`: baselines in `<store>/baselines/<component>/<id>.psig`. `colocated`: baselines in `<srcRoot>/<component>/__pxsig__/<id>.psig`.                                                                                                                                                                                                                                                                                                                                                                                  |
| `capture.viewport`        | `[900, 600]`                                               | Browser viewport, `[width, height]` in CSS pixels, at device scale 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `capture.settleMs`        | `200`                                                      | Minimum wait after fonts load, before the layout-stability wait.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `capture.target`          | `"#storybook-root"`                                        | The element captured. A story can override it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `capture.ignore`          | `[]`                                                       | Selectors masked in every story of the project, besides every element with `data-volatile` ([masks](#masks)). Replaces the list inherited from the workspace `defaults`.                                                                                                                                                                                                                                                                                                                                                   |
| `capture.addIgnore`       | `[]`                                                       | Selectors added to the inherited `capture.ignore` list instead of replacing it ([masks](#masks)).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `capture.waitFor`         | `[]`                                                       | Extra waits for content that animates in script: `{ selector, minMs?, stableMarkup? }`. A rule applies when its `selector` matches. `minMs` raises the minimum wait; `stableMarkup` waits until the markup under that selector stops changing.                                                                                                                                                                                                                                                                             |
| `capture.browserEndpoint` | `null`                                                     | A Playwright browser server (`ws://…`) to render with instead of launching a browser on this machine: usually the container's, from `pxsig browser start` ([container.md](container.md)). Every engine (Chromium, Firefox, WebKit) connects to it; Storybook on this machine's localhost stays reachable. The project's Playwright must be the server's major.minor. Also `--browser` and `PXSIG_BROWSER_WS`.                                                                                                              |
| `capture.launchArgs`      | `[]`                                                       | Chromium arguments added after pxsig's own (`--disable-lcd-text`, `--font-render-hinting=none`); a later value of the same switch wins. Recorded as `browser.launchArgs` ([text rendering](#text-rendering)).                                                                                                                                                                                                                                                                                                              |
| `grid`                    | `64`                                                       | Signature grid, cells per side (8..256).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `minCellPx`               | `8`                                                        | Adaptive grid: cells at least this many pixels wide, capped by `grid` (see [spec.md](spec.md#2-signature-construction)).                                                                                                                                                                                                                                                                                                                                                                                                   |
| `detail`                  | `true`                                                     | Write the detail channel into new baselines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `trim`                    | `{ "pad": 16, "tolerance": 8 }`                            | Crop renders to their content (right and bottom) before checking. `pad` pixels are kept around the content; a pixel is content when it differs from the bottom-right pixel by more than `tolerance`. `false` turns trimming off.                                                                                                                                                                                                                                                                                           |
| `gate`                    | see below                                                  | The gate for every entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `modes`                   | `{ "default": { "globals": "", "colorScheme": "light" } }` | Named render settings (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `defaultMode`             | first key of `modes`                                       | The mode whose entries keep the bare story id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `modesByDefault`          | `[defaultMode]`                                            | Modes every story is rendered in, unless the story says otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `suites`                  | `{}`                                                       | Extra manifests for other mode sets (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `affects.workspaceDeps`   | `true`                                                     | A change in the source of a workspace package this project depends on (runtime and peer dependencies with a `workspace:` range) selects every entry.                                                                                                                                                                                                                                                                                                                                                                       |
| `affects.extra`           | `[]`                                                       | More paths whose change selects every entry (for example the Storybook config folder, a lockfile).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `affects.ignore`          | `[]`                                                       | Globs for changed paths that select nothing when nothing traced claims them: docs, other apps, CI config ([ci.md](ci.md#how-selection-decides)). Anchored like `affects.extra` (the project folder; `$workspace/` for the workspace root), plus `$repo/` for paths outside the workspace. `*` within a folder, `**` any depth, `?`, `{a,b}`; a trailing `/` matches a folder's contents. Never hides a baseline, a store file, an "affects every entry" path or a module a story imports. Not replaced by `PXSIG_SOURCES`. |
| `affects.aliases`         | `{}`                                                       | Import aliases only a bundler knows (Vite `resolve.alias`): specifier prefix → path, anchored like `affects.extra`; the longest prefix wins. `{ "@acme/ui": "src" }` makes `@acme/ui/Button` the file `src/Button`. Without it such an import is unresolved ([ci.md](ci.md#what-counts-as-an-import)).                                                                                                                                                                                                                     |
| `affects.unresolved`      | `[]`                                                       | Globs of files whose unresolved imports are accepted (a `virtual:` module, a computed `import()`), anchored like `affects.ignore`. Without it, an unresolved import adds the entries that reach its file to every `check --since` run, and every entry when the file affects every entry.                                                                                                                                                                                                                                  |
| `nonVisual`               | `[]`                                                       | Top-level folders under `srcRoot` with no visual stories. Their stories are not entries and are reported as `excluded`.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `react`                   | `{}`                                                       | React features ([react](#react)). `false` (or `"off"`) turns all of them off.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `react.renders`           | `false`                                                    | Count React commits and component renders in every render ([react](#react)).                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `text`                    | `true`                                                     | Text capture ([text](#text)): each render also writes its text record, and an approved baseline stores it. `false` turns it off.                                                                                                                                                                                                                                                                                                                                                                                           |
| `text.ignore`             | `[]`                                                       | Selectors whose text is never recorded ([text](#text)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `text.movePx`             | `0.5`                                                      | Labels only: how far a text box may move and still be in place ([text](#text)).                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `text.edgePx`             | `2`                                                        | Labels only: how far around a run a changed pixel still belongs to it ([text](#text)).                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `text.noisePx`            | `0`                                                        | Labels only: changed pixels outside text a text label still allows ([text](#text)).                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `a11y`                    | `true`                                                     | Run axe on every render.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `env`                     | `{}`                                                       | The render environment each baseline records and each check compares (below).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `env.ignore`              | `[]`                                                       | Environment fields left out of the comparison, by name, for example `["render.timezone"]` when no story formats a date.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `env.fontProbe`           | `[]`                                                       | Font families measured besides `serif`, `sans-serif`, `monospace` and `system-ui`, so a font difference names the family. The probe page loads no stylesheet, so this measures fonts installed on the machine (a family that is not installed measures as the fallback); a web font the stories load from the repository is part of the story, not the environment.                                                                                                                                                        |
| `env.strict`              | `false`                                                    | Refuse a check (exit 2, nothing rendered) when a selected baseline was approved in a different environment. Same as `check --strict-env` and `PXSIG_STRICT_ENV=1`.                                                                                                                                                                                                                                                                                                                                                         |
| `enforcement`             | `{}`                                                       | Warn mode: per gate, `enforce` or `warn` (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `integrity`               | `{}`                                                       | Integrity options (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `approvals.identity`      | (none)                                                     | No longer read (0.7.6): no approval, accessibility or repair log line names a person, whatever this says; the commit that adds a line and the pull request say who (`pxsig approve log --trace`). A config that still has the key loads, and `pxsig doctor` reports it (`approvals-identity`: a warning for `git-email`, a note for `none`). Remove it.                                                                                                                                                                    |
| `approvals.level`         | `standard`                                                 | `standard`: a typed phrase at a terminal, or the dashboard opened with the dashboard link. `strict` is reserved for a later release and refused for now (a setup error).                                                                                                                                                                                                                                                                                                                                                   |
| `approvals.byStory`       | `false`                                                    | `true` lets the dashboard approve a story's waiting entries (each mode and state) together, in one batch (**Approve story**). `false`: each entry is approved on its own, after it is looked at; the server refuses `POST /__pxsig/approve-story`.                                                                                                                                                                                                                                                                         |
| `rejections`              | see [below](#rejections)                                   | A rejection's note and its packet: the crops, `rejection.md` and `rejection.json` in the store's git-ignored `reports/`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `dashboard.ui`            | none                                                       | A UI adapter for `pxsig dashboard build` and `gaps`: a path to its module, relative to this folder, or a built-in adapter's name (see [ui/build-adapter.md](ui/build-adapter.md)). `pxsig serve` then serves this project's build while it is current.                                                                                                                                                                                                                                                                     |

### `gate`

| Key             | Default                                                          | Meaning                                                             |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `threshold`     | `24`                                                             | Per-cell mean RGB delta that counts a cell as changed.              |
| `minCells`      | `3`                                                              | Fail when at least this many cells changed. `0` turns the rule off. |
| `minSsim`       | `0.99`                                                           | Fail when SSIM is below this.                                       |
| `maxChangedPct` | `2`                                                              | Fail when more than this percentage of cells changed.               |
| `maxEdgePct`    | off                                                              | Fail when the edge-map difference is above this percentage.         |
| `detail`        | `{ "blockDelta": 32, "energyDelta": 48, "minTiles": 3 }`         | Detail-channel rule, or `false` to turn it off.                     |
| `color`         | `{ "deltaE": 3, "minArea": 64, "cellDeltaE": 5, "minCells": 3 }` | The color rule (below), or `false` to turn it off.                  |

The metrics are defined in [spec.md](spec.md#4-metrics-and-gate).

#### `gate.color`

The color rule fails an entry the other rules pass when a small area changes color at about the
same lightness: a badge's tint, a status color, a lost row highlight
([spec.md](spec.md#the-color-rule)). It is on by default since 0.7.7.

| Key          | Default | Limit | Meaning                                                                                                                                                                                                          |
| ------------ | ------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deltaE`     | `3`     | 10    | CIEDE2000 difference at which a flat pixel (3×3 luminance range under 8 in both images) counts as changed. A render of another size than its baseline is compared over the region both cover, from the top-left. |
| `minArea`    | `64`    | 1024  | Fail when at least this many connected flat pixels changed. `0` turns the flat-area check off.                                                                                                                   |
| `cellDeltaE` | `5`     | 15    | CIEDE2000 difference of a cell's mean color at which the cell counts as changed.                                                                                                                                 |
| `minCells`   | `3`     | 16    | Fail when at least this many cells changed color. `0` turns the cell check off. Not checked when the render's size is not the baseline's.                                                                        |

Loosen it for a project the way any gate key is set: in `pxsig.config.json`, in the workspace
file's `defaults.gate`, or for one story in `parameters.pxsig.gate` (it has no `PXSIG_*` variable
or binary flag). Each key set replaces the default for that key only:

```json
{ "gate": { "color": { "deltaE": 5, "minArea": 128 } } }
```

It cannot be turned off quietly. The resolved rule is recorded on every row of `check.json`
(`gate.color`, `null` when off), `pxsig config` names the layer that set it, and an entry checked
with the rule off, with either check off, or with a key past its limit (the schema allows no more,
but a story's gate is not checked against it) is counted in the `gate-color-off` warning that
`pxsig doctor` and the dashboard's Coverage view show
([integrity.md](integrity.md#setup-problems)). That warning cannot be lowered: `integrity.severity`
can raise it to `error`, and a lower value is named in its reason instead of applied. The defaults are calibrated on container renders.

### `modes`

A mode is a set of render settings. Every story is rendered once per mode it uses.

| Key           | Meaning                                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `globals`     | Storybook globals for the render, in URL form: `"theme:dark;density:compact"`.                                                                                                                                       |
| `colorScheme` | `light` or `dark`, emulated by the browser (`prefers-color-scheme`).                                                                                                                                                 |
| `viewport`    | `[width, height]`, overrides `capture.viewport`.                                                                                                                                                                     |
| `browser`     | `chromium` (default), `firefox` or `webkit`. Each needs its Playwright browser installed.                                                                                                                            |
| `extends`     | Another mode's name. Its resolved keys are copied first, then this mode's. Chains of any length resolve (`mobile` extends `brand` extends `dark`); a cycle or an unknown name is a setup error that names the chain. |

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

| Result       | When                                                     | Effect                                                                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `same`       | every field equal                                        | none                                                                                                                                                                                                                                                    |
| `compatible` | only minor fields differ                                 | listed in `check.json` (`envDiff`); no warning                                                                                                                                                                                                          |
| `mismatch`   | a major field differs                                    | the `env-mismatch` warning: one line in `check`, a line in `summary.md`, a setup finding in `pxsig doctor` and the dashboard's coverage banner. With `env.strict`, `--strict-env` or `PXSIG_STRICT_ENV=1`, the check refuses before rendering (exit 2). |
| `unknown`    | the baseline records no environment (written before 0.5) | none, ever                                                                                                                                                                                                                                              |

| Field                                                       | Tier                                         | What                                                                                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser.name`, `browser.channel`, `browser.launchArgs`     | major                                        | the Playwright browser, the channel it launched with (`chrome`, `msedge` when the bundled browser is missing), the Chromium launch arguments ([text rendering](#text-rendering)) |
| `browser.version`                                           | major on the first number, minor on the rest | the full browser build                                                                                                                                                           |
| `playwright`                                                | minor                                        | the Playwright version pxsig resolved                                                                                                                                            |
| `axe`                                                       | minor                                        | the axe-core version of the a11y pass (pxsig's own dependency); absent in an environment written before it was recorded                                                          |
| `os.platform`, `os.arch`                                    | major                                        | `darwin`, `linux`, `win32`; `arm64`, `x64`                                                                                                                                       |
| `os.release`, `os.distro`                                   | minor                                        | the kernel release; the Linux distribution, else the OS version string (on macOS without the kernel build)                                                                       |
| `fonts.probe`                                               | major                                        | a digest of canvas text widths at three sizes for each probed family, with one 8-character digest per family so a difference names it                                            |
| `fonts.system`                                              | minor                                        | a digest of the installed font list where `fc-list` exists (Linux, the container), else `null`                                                                                   |
| `render.dpr`, `render.reducedMotion`                        | major                                        | the capture settings (1, `reduce`)                                                                                                                                               |
| `render.gpu`                                                | major                                        | a class (`swiftshader`, `angle-metal`, `angle-gl`, `angle-vulkan`, `masked`, `none`), never the renderer string                                                                  |
| `render.colorGamut`, `render.timezone`, `render.locale`     | major                                        | what the probe page reports                                                                                                                                                      |
| `capture.pipeline`                                          | major                                        | a number pxsig bumps when its capture code changes how renders look                                                                                                              |
| `container.image`, `container.revision`, `container.digest` | minor                                        | `PXSIG_IMAGE`, `PXSIG_IMAGE_REVISION`, `PXSIG_IMAGE_DIGEST` when set                                                                                                             |
| `pxsig`, `engine`, `node`                                   | minor                                        | the versions that rendered                                                                                                                                                       |

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

| Key               | Default   | Meaning                                                                                                                                                                                                                                                                                                |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `default`         | `enforce` | Every gate not named in `gates`, except `a11y`, which keeps its own default.                                                                                                                                                                                                                           |
| `gates`: `visual` | `enforce` | `check`: rows not passing (changed, new, render errors).                                                                                                                                                                                                                                               |
| `gates`: `a11y`   | `warn`    | New axe violations against each entry's accepted list (`a11y.json`). On its default `warn` it is quiet: nothing is printed unless a new violation appears, then one ADVISORY line and a `summary.md` lead, exit 0. `enforce`: a new violation fails the run (exit 1). `off`: no a11y gate and no line. |
| `gates`: `verify` | `enforce` | `approve verify`: baselines with no log line. A mismatch, an interrupted approval or a rewritten log fails in every mode.                                                                                                                                                                              |
| `gates`: `env`    | `enforce` | `--strict-env`'s refusal: on `warn` the check renders anyway and lists the baselines it would have refused.                                                                                                                                                                                            |
| `gates`: `doctor` | `enforce` | `pxsig doctor` findings at or above `--fail-on`. A setup error still exits 2.                                                                                                                                                                                                                          |
| `gates`: `stale`  | `enforce` | `pxsig stale`: stale or inconsistent verdicts.                                                                                                                                                                                                                                                         |
| `warnUntil`       | none      | `YYYY-MM-DD`, the end of that day in UTC. After it the gates set to `warn` here are enforced, with no commit. Extending it is a one-line change in a pull request.                                                                                                                                     |
| `noticeDays`      | `14`      | From this many days before `warnUntil`, every run, `summary.md`, `pxsig status` and `pxsig doctor` (`enforcement-ending`) say when warn mode ends.                                                                                                                                                     |
| `advisoryExit`    | `0`       | The exit code of a run that would have failed only in gates on warn: `0`, or `10` to `125` for a forge's own warning state (GitLab `allow_failure: exit_codes`, Jenkins `UNSTABLE`). `1`, `2` and `3` are refused.                                                                                     |

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

### `react`

React features: the compiler analysis ([`pxsig react`](cli.md#pxsig-react---since-----files-ab----all), and
`pxsig check --since` / `--changed` while it renders) and render counting. Alerts only: nothing here changes an exit code, a gate, JUnit or a baseline. Also
under the workspace file's `defaults` (the project's own key wins).

| Key               | Default                 | Meaning                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compiler`        | `"auto"`                | `true` or `"auto"`: compare the React Compiler's verdict on changed files at the merge base and now, when `babel-plugin-react-compiler` and `@babel/core` are installed in the project. `"babel"`: that plugin only, the same as `"auto"` today. `"oxc"`: the engine's built-in compiler (below), even when the Babel plugin is installed. `false` (or `"off"`): never. |
| `lint`            | `true`                  | Also the validation-only findings eslint-plugin-react-hooks reports (`set-state-in-effect`, …) on functions that still compile. A new one is an alert (level note).                                                                                                                                                                                                     |
| `compilationMode` | `"infer"`               | As the project's build: `infer`, `annotation`, `syntax`, `all`.                                                                                                                                                                                                                                                                                                         |
| `target`          | `"auto"`                | `auto`: the major of the `react` the project has (17, 18, 19; else 19).                                                                                                                                                                                                                                                                                                 |
| `environment`     | `{}`                    | Compiler environment flags (JSON values), as the project's build sets them. pxsig never reads the project's Babel or Vite config.                                                                                                                                                                                                                                       |
| `exclude`         | stories, tests, `.d.ts` | Globs, workspace-relative, of changed files not analysed. Default `**/*.stories.*`, `**/*.test.*`, `**/*.spec.*`, `**/*.d.ts`, `**/*.css.ts`, `**/__tests__/**`, `**/__mocks__/**`. Replaces the list when set.                                                                                                                                                         |
| `renders`         | `false`                 | Count React commits and the components that rendered, in every render, with a hook defined before the story loads (no dependency, nothing sent anywhere). Each check row gets `renders` ([spec.md](spec.md#render-counts)); an entry React was still committing at capture is an alert.                                                                                 |

Off switches, for every React feature at once: `"react": false` (or `"off"`) in
`pxsig.config.json` (or in `defaults` of `pxsig.workspace.json`), `--no-react` for one run,
`PXSIG_REACT=off` in the environment. A bad value is one warning line, a `pxsig doctor` finding
(`react-config`), and the part it belongs to off for the run, never a failed check: a bad
`renders` turns render counting off, any other bad key the compiler analysis, and a `react` that
is neither `false` nor an object everything.

The compiler and Babel are not dependencies of pxsig, optional or peer: installing pxsig installs
neither, a project that already uses the compiler adds nothing, and a project that wants the
analysis installs both (`npm install -D babel-plugin-react-compiler @babel/core`). pxsig resolves them from the project's
folder up to the workspace root, never from its own install. Tested with
`babel-plugin-react-compiler` 1.0.0 under `@babel/core` 7.29 and 8.1. See
[`pxsig react`](cli.md#pxsig-react---since-----files-ab----all).

`"compiler": "oxc"` uses the compiler built into the engine instead: `oxc_react_compiler` 0.143.0,
the React Compiler's Rust port, which is experimental. It needs no Node packages, so a project that
builds without Babel (Vite with `oxc-transform-react`, for example) gets the analysis too, and it
runs several times faster. It runs in an engine process of its own: a file that crashes it is a
`compiler-error` and the others still compile. It tracks the React Compiler's main branch, so it
can differ from the released Babel plugin on a few functions; a project that builds with the Babel
plugin keeps `"auto"` or `"babel"`. `compilationMode`, `target`, `lint` and the `environment` flags
it has map to it; an `environment` key it has no field for is left out with a note. Each run names
its compiler: `backend` in `react.json`, the `compiler:` line of `pxsig react`, `pxsig doctor`,
`pxsig_react` and the SARIF tool extension. `"auto"` keeps meaning the Babel plugin: a later
release may let it pick the built-in compiler for projects without Babel, once the two agree on
every function of the released plugin's corpus, with a `To update:` line.

### `text`

Text capture: right after each screenshot, pxsig reads the text the render draws and writes it
beside the PNG as `<id>.boxes.json`, the render's **text record**. A baseline approved from that
render stores the record as its `boxes` section ([spec.md](spec.md#5-the-psig-container-version-1)),
deflated, and `pxsig cat` prints its strings, so `git diff` of a baseline shows a copy change.
`pxsig check` compares a render's record with its baseline's and labels the change in check.json
(the row's `textDiff`: copy, copy with reflow, moved, restyled, or a pixel change), but only when
the render and the baseline were made in the same environment (the same env id the pixel check
reports); otherwise the row says `env-differs` and compares nothing. Labels only: reading changes no
pixel, and the render, the gate, every verdict and exit code are the same with text capture on or
off.

The labels are shown in `pxsig entry` (a Text block: the kind and one sentence per change, such as
`Copy: "1" → "1␠" (whitespace only: a space added)`), `pxsig list` (`· text: copy, reflow` after
the first reason; `--text <kind>` keeps one kind), MCP `pxsig_list` and `pxsig_entry`
([mcp.md](mcp.md#text-labels)), summary.md (after a changed entry's reasons), and the dashboard's
inspector (a badge beside the verdict, and a Text section whose changes show their box on the stage). A row whose
environment differs says that text is compared only within one environment: a render from that
environment approved as the baseline gives it labels. The row's shape is in
[spec.md](spec.md#text-labels).

What a record holds, per run (a DOM Text node the screenshot draws): its string as in the DOM, one
box per line fragment in the screenshot's frame (CSS px, rounded to 0.01), its font facts (family,
size, weight, style, line height, letter and word spacing, transform, decoration, colour, font
features and variation, and whether that face had loaded), a path of child indices from the
capture root, and a key (the nearest `data-testid`, or an id that is not a generated one, when no
other run has it). Beside the runs: the boxes of painted elements (a visible background, border or
shadow, and `svg`, `img`, `canvas`, `video`), and counts of what was left out.

What is left out: text with no box of at least 2×2 px inside the frame, text an `overflow` ancestor
clips, text that is not visible (`display`, `visibility`, `opacity`), text under an open dialog it
is not part of, text under the entry's `ignore` masks and `text.ignore`, `iframe` content, and every
form field (`input`, `textarea`, `select`, `option`, `contenteditable`): a field's value is never
read. `::before` / `::after` content and text drawn in a `<canvas>` are not Text nodes and are not
recorded. The strings are what the page renders as captured, mostly what the baseline image shows;
the record is committed inside the `.psig`, beside that image.

| Key       | Default | Meaning                                                                                                     |
| --------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `ignore`  | `[]`    | CSS selectors whose text is never recorded, beside each entry's `ignore` masks.                             |
| `movePx`  | `0.5`   | Labels only: how far a text box may move (px) and still be in the same place.                               |
| `edgePx`  | `2`     | Labels only: how far around a run's boxes (px) a changed pixel still belongs to it (anti-aliasing fringes). |
| `noisePx` | `0`     | Labels only: changed pixels outside text that a text label still allows.                                    |

Text capture is on by default; `"text": false` (or `"off"`) in `pxsig.config.json` or
`defaults` of `pxsig.workspace.json`, `--no-text` for one run, or `PXSIG_TEXT=off` turns it off. A
story turns it off for its own entries with `parameters.pxsig.text: false`. A `text` that is not a
boolean or an object, or a `text.ignore` that is not an array of selectors, is one warning line and
text capture off for the run, never a failed check; a `movePx`, `edgePx` or `noisePx` that is not a
number of 0 or more (`noisePx` a whole number) is a warning and its default; a key this version does
not know is a warning and ignored. `pxsig doctor` says whether it is on, and how many baselines have a text record. A
baseline approved before text capture, or with it off, has none until it is approved again: nothing
rewrites a baseline on its own.

### Masks

Some content varies from run to run: a time, "3 minutes ago", a commit hash, a build number, a
generated id. Give the story fixed data first (a fixed clock, fixed ids): a fixed value is still
compared. When that is not possible, mask it. A mask paints the inside of an element's box in one
colour before the screenshot, so what is inside never differs; the box follows the element, so a
change to its size or position still shows. The box is painted at the element's own place in the
page, so anything above it (an open popover, a tooltip) is still captured. Where that cannot be
exact (an image or form control, a faded or filtered parent, a static element with offsets or
absolutely positioned children) it is painted over everything instead, as before 0.7.7: never less
than the element's box. Only the elements measured just before the screenshot are painted; an
element a mask matches only at the screenshot, or a mask on more than 500 elements, fails the
entry (`mask not measured: …`).

| Where                         | Masks                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data-volatile` on an element | That element, in every project, with no configuration. Its value is the reason, and is required: `data-volatile="relative time"`. Only on a leaf: text and inline formatting (`span`, `b`, `i`, `em`, `strong`, `code`, `time`, `abbr`, `sub`, `sup`, `small`, `mark`, `br`, `wbr`) inside, nothing else. On a container the entry fails as `mask on a container: …`, with no value as `mask needs a reason: …`; neither is painted. |
| a story's `ignore`            | These selectors in that story's captures ([story parameters](#story-parameters)).                                                                                                                                                                                                                                                                                                                                                    |
| `capture.ignore` (project)    | These selectors in every story of the project.                                                                                                                                                                                                                                                                                                                                                                                       |
| `capture.ignore` (workspace)  | The same key under the workspace file's `defaults`: every project, unless a project sets its own `capture.ignore`.                                                                                                                                                                                                                                                                                                                   |
| `capture.addIgnore`           | Selectors added to the list inherited from the layer below, instead of replacing it.                                                                                                                                                                                                                                                                                                                                                 |

The author of a component sets `data-volatile` once, on the element that shows the value, and every
team that renders the component gets the mask. `pxsig config` lists each config selector with the
layer that set it. Text under a painted mask is left out of the text record ([`text`](#text)); the
a11y pass still runs on it. A mask on the story root (the root itself, or an element that is all of
its content) is recorded as such (`root`), and fails the entry when it covers 95% of the capture or
more; a smaller one is weighed by its share.

Each render records the masks that applied to it, `<id>.masks.json` beside the PNG (selector,
source, reason, the elements matched and their boxes), and every baseline approved from it keeps
them in its header, with each mask's share of the capture, or an empty list when none applied
([spec.md](spec.md#5-the-psig-container-version-1)); no paths. `pxsig check` compares a render's
masks with its baseline's: a mask added, removed, grown by any pixel, moved by more than a pixel,
or matching another number of elements fails the entry with the reason `masks changed: …`, for a
person to approve, whatever the pixels. Adopting `data-volatile` (or a new `capture.ignore`)
therefore gives one "masks changed" entry per affected entry, approved once. Against a baseline
approved before every baseline recorded its masks (0.7.6 and earlier), a story's `ignore` is not a
change where the baseline image shows it painted; anywhere else it is added.

Masks are content, so trimming a capture never crops one away: a component that grows under a mask
in its bottom-right corner still changes the trimmed size.

Limits, over all of an entry's masks together:

| Masks cover                                | Result                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| over 25% of the capture                    | A warning (`[check] mask:`, summary.md, `check --sarif` `pxsig/large-mask`): such masks let most changes under them pass.                                                                                                                                                                                                                                       |
| over 50% of the capture, or the story root | The entry fails (`masks cover 62% of the capture, over 50%`, `a mask covers the story root: …`; SARIF `pxsig/mask-limit`, an error). No approval writes its baseline, `--update` and `--allow-masks` included: the entry fails until the masks are smaller, and every refusal says what to do (`make the masks smaller`, `mask the value, not the story root`). |

A mask is for content that varies from run to run, never for a change: an assistant is told,
wherever it reads pxsig, "Never add a mask, ignore, `data-volatile` or raise a threshold to make an
entry pass; flag the entry for a person instead." ([agents.md](agents.md#masks)).

`pxsig check --update` and the engine's `pxsig baseline` never write a masks change unnamed: an
entry whose masks differ from its baseline's is refused, with what changed, unless `--allow-masks`
names it (alone: every entry).

The dashboard's inspector lists an entry's masks (selector, source, reason, share of the capture)
in its Masks section, and marks Masks changed and Large mask beside the verdict and on the entry's
card; Open items counts the entries with a large mask. A masks change with no pixel over the
tolerance shows each mask's share in the baseline and in the render, first in the side panel.
`pxsig help volatile` and the dashboard's Help ("Values That Vary") say the same, fixed data first.

### `rejections`

A rejection keeps its reason (the note) until it closes, and gets a **rejection packet**:
`<store>/reports/rejected/<id>/` (`<id>.a11y/` for accessibility) with `rejection.md` (for a person
and an assistant), `rejection.json` (the same facts, for tools), `baseline.png`, `current.png`,
`mask.png` (the changed pixels, from the engine's `diff`) and full-size crops of the changed
regions (`crops/<n>.baseline.png`, `.current.png`, `.diff.png`, largest first). The packet is
written after a reject, refreshed after each check of the entry (the server's re-check and a full
check), and removed when the rejection closes; the server removes left-over packets at start. It is
written only while git leaves the store's `reports/` out: otherwise none is written, the open
rejection says why (`packetError`), and `pxsig doctor` reports `reports-not-ignored`.

| Key                        | Default  | Meaning                                                                                                                                                                                      |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rejections.note.ask`      | `true`   | Reject asks for an optional reason in the dashboard; `false`: Reject and R reject at once.                                                                                                   |
| `rejections.packet`        | `true`   | Write packets; `false`: the note only.                                                                                                                                                       |
| `rejections.crop.pad`      | `24`     | Padding around each changed region, 0 to 256 px. Padded regions that overlap are merged into one crop.                                                                                       |
| `rejections.crop.max`      | `6`      | Crops per packet, 1 to 20, the most changed pixels first.                                                                                                                                    |
| `rejections.crop.scale`    | `"auto"` | Nearest-neighbour upscale: `"auto"` brings the short side to at least 160 px, at most 4×; or `1`, `2`, `4`. Never past 1,024 px on the long side; a crop larger than that at 1× is left out. |
| `rejections.crop.annotate` | `true`   | Outline each changed region on the three crops.                                                                                                                                              |
| `rejections.structure`     | none     | A folder, relative to the project, of committed structure locks (`<section>/<name>.aria.yml`) to compare with `<store>/reports/structure/`; `rejection.md` then has a Structure section.     |

A bad value is a setup error. Fixed, and not configurable: the location inside `reports/` and the
git-ignore check, the 280-character note, the file names, the goal line, the re-check command and
the prompt wording. Every path in a packet is relative (to the packet, the store or the workspace),
and nothing in it approves.

### `integrity`

| Key                      | Default         | Meaning                                                                                                                                 |
| ------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `requireBaselineImages`  | `true`          | Report `missing-baseline-image` when a baseline has no image. A spec v1 `.pxsig.json` baseline never has one.                           |
| `staleAfterSourceChange` | `true`          | Report `stale` when a source changed after a verdict.                                                                                   |
| `sourceRoots`            | `null`          | Folders, relative to the workspace root, whose edits can make a verdict stale. Default: `srcRoot`.                                      |
| `maxTracedFiles`         | `400`           | Above this many edited files, staleness falls back to "same component folder" instead of the import graph.                              |
| `severity`               | `{}`            | Per-code severity override, for example `{ "unbaselined": "error" }`.                                                                   |
| `indexTimeoutMs`         | `4000`          | Timeout for fetching Storybook's `index.json`.                                                                                          |
| `renderSkewMs`           | `5000`          | A render written this long after its verdict makes the verdict stale.                                                                   |
| `manifests`              | suite manifests | Other manifests, relative to the store, whose baselines are not orphans. Default: every `manifest.<suite>.json` beside `manifest.json`. |

### Advanced

| Key                 | Meaning                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `importPathPattern` | A regular expression that decides which story files belong to the project, with the component folder as capture group 1. Default: files under `srcRoot`. |

## Environment variables

| Variable                                                                                              | Read by                  | Meaning                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PXSIG_WORKSPACE`                                                                                     | CLI, MCP, server         | The workspace root. Skips the walk up from the current folder.                                                                                                                                                                                                 |
| `PXSIG_ROOT`                                                                                          | CLI, MCP, server         | Older name for `PXSIG_WORKSPACE`. Kept for 0.2.                                                                                                                                                                                                                |
| `PXSIG_PROJECT`                                                                                       | CLI, MCP                 | The project, when `--project` is not given.                                                                                                                                                                                                                    |
| `PXSIG_BIN`                                                                                           | CLI, MCP, server         | Path to the `pxsig` binary, for example a local `target/release/pxsig`.                                                                                                                                                                                        |
| `PXSIG_URL`                                                                                           | CLI, MCP                 | The server URL. Overrides `server.json` and `server.port`.                                                                                                                                                                                                     |
| `PXSIG_STORYBOOK_URL`                                                                                 | CLI, MCP, server         | Overrides `storybook.url`.                                                                                                                                                                                                                                     |
| `PXSIG_GRID`                                                                                          | CLI, MCP, server, binary | Overrides `grid`.                                                                                                                                                                                                                                              |
| `PXSIG_SOURCES`                                                                                       | CLI, MCP, server         | Comma-separated workspace-relative paths whose change selects every entry. Replaces `affects` (workspace dependencies are not added), and replaces the staleness source roots.                                                                                 |
| `PXSIG_FORMAT`                                                                                        | CLI                      | Output format: `pretty`, `plain` or `json`.                                                                                                                                                                                                                    |
| `PXSIG_DASHBOARD_DIR`                                                                                 | server, `report`         | A dashboard folder to serve or write instead of the prebuilt one, above `dashboard.ui`'s build.                                                                                                                                                                |
| `PXSIG_UI_ADAPTER`                                                                                    | dashboard build          | The UI adapter, by built-in name or path; above `dashboard.ui`.                                                                                                                                                                                                |
| `PXSIG_AGENT`                                                                                         | CLI, MCP, server         | Marks the shell as a coding assistant's, for one that sets no marker of its own: plain output, commands that need a person are refused, and log lines carry `agent` (the value, or `agent` for `1`). The other markers are in [agents.md](agents.md#markers).  |
| `PXSIG_NO_DELEGATE`                                                                                   | CLI                      | Do not hand over to the workspace root's install (see [monorepo.md](monorepo.md#installs)).                                                                                                                                                                    |
| `PXSIG_THREADS`                                                                                       | binary                   | Worker threads for batch commands. Default: logical CPUs.                                                                                                                                                                                                      |
| `PXSIG_THRESHOLD`, `PXSIG_MIN_SSIM`, `PXSIG_MAX_CHANGED_PCT`, `PXSIG_MAX_EDGE_PCT`, `PXSIG_MIN_CELLS` | binary                   | Gate values above the project's `gate` and below the gate flags and every story's own gate (see [spec.md](spec.md#gate-resolution)).                                                                                                                           |
| `PXSIG_ENFORCEMENT`                                                                                   | CLI                      | `enforce`: every gate enforced for this run, whatever the config says ([enforcement](#enforcement)). `warn` is refused (exit 2): warn mode comes from the committed config or `--warn` at a terminal.                                                          |
| `PXSIG_REACT`                                                                                         | CLI, server              | `off`: every React feature off, like `--no-react` ([react](#react)).                                                                                                                                                                                           |
| `PXSIG_TEXT`                                                                                          | CLI, server              | `off`: text capture off for this run, like `--no-text` ([text](#text)).                                                                                                                                                                                        |
| `PXSIG_STRICT_ENV`                                                                                    | CLI                      | `1`: `check --full` refuses when a selected baseline was approved in a different render environment, like `--strict-env` ([env](#env)).                                                                                                                        |
| `PXSIG_IMAGE`, `PXSIG_IMAGE_REVISION`, `PXSIG_IMAGE_DIGEST`                                           | CLI, server              | Recorded in each render's environment (`container.*`); the pxsig container image sets the first two, a runner may set the digest.                                                                                                                              |
| `PXSIG_BROWSER_WS`                                                                                    | CLI, server              | Overrides `capture.browserEndpoint`: render with that browser server ([container.md](container.md)).                                                                                                                                                           |
| `PXSIG_PLAYWRIGHT`                                                                                    | CLI, server              | A Playwright package folder to load before the project's. The container image sets it to its own (`/opt/pxsig/node_modules/playwright`), so the driver always matches the browsers installed beside it. Unset, Playwright resolves from the project as before. |
| `PXSIG_DEBUG`                                                                                         | CLI, MCP, server         | `spawn`: print every program pxsig starts, with its arguments, on stderr ([platforms.md](platforms.md#programs-pxsig-starts)). `pxsig serve --debug` sets it.                                                                                                  |
| `NO_COLOR`, `FORCE_COLOR`                                                                             | CLI                      | Colour in terminal output.                                                                                                                                                                                                                                     |

## Story parameters

Per-story settings live in the story file, on a story or on its meta, under `parameters.pxsig`.
pxsig reads them from Storybook's index.json (the running Storybook, or the build in
`storybook.staticDir`), so they are exactly what the story declares.
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
        {
          name: 'open',
          action: 'click',
          target: '[aria-haspopup]',
          waitFor: '[role="menu"]',
          fullPage: true,
        },
      ],
      delay: 400,
    },
  },
};
```

| Key        | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `disable`  | `true` leaves the story out. The tag `no-pxsig` does the same.      |
| `modes`    | Render in exactly these modes.                                      |
| `addModes` | Render in `modesByDefault` plus these.                              |
| `gate`     | Gate overrides for this story's entries (same keys as `gate`).      |
| `grid`     | Signature grid for this story. Turns the adaptive grid off.         |
| `detail`   | `false`: no detail channel in this story's baselines.               |
| `viewport` | `[width, height]`, overrides the mode's and the project's viewport. |
| `ignore`   | CSS selectors masked before every capture ([masks](#masks)).        |
| `states`   | Extra captures after an interaction, one entry each (below).        |
| `delay`    | Extra settle time, in ms.                                           |
| `target`   | The element to capture, instead of `capture.target`.                |
| `a11y`     | `false` skips the axe pass.                                         |
| `text`     | `false`: no text record for this story's renders ([`text`](#text)). |

Each item in `states`:

| Key        | Meaning                                                                                 |
| ---------- | --------------------------------------------------------------------------------------- |
| `name`     | State name; the entry id gets `__<name>`. Lowercase letters, digits and hyphens.        |
| `action`   | `hover`, `focus`, `click`, `rightclick` or `press`.                                     |
| `target`   | Selector of the element to act on. Default: the first element inside `capture.target`.  |
| `key`      | For `press`: a key name or an array of them. Default `Tab`.                             |
| `waitFor`  | Selector to wait for after the action.                                                  |
| `fullPage` | Capture the viewport instead of the target, for popups rendered outside the story root. |

A key above with a value of the wrong type (`grid: '96'`, `ignore: '.live'`, a state with no `name`)
is a setup error (exit 2) that names the story and the key, in `pxsig manifest` and when a repair
registers the story.

## Renders

Every render uses a fixed viewport at device scale 1, reduced motion, a stylesheet that turns
animations, transitions and carets off, a fixed `Math.random`, `document.fonts.ready`, and a wait
until the layout stops moving. Story ids and globals go in the iframe URL. Without a bundled
Chromium, pxsig tries the installed Chrome, then Edge.

### Text rendering

Chromium launches with `--disable-lcd-text --font-render-hinting=none`: text is antialiased in
grayscale, not in LCD subpixel colour, and glyph advances are not rounded to whole pixels. Without
them a Linux render (the container, CI) draws coloured fringes and narrower text than macOS, so a
render and the Storybook it came from look different. pxsig's container image sets the same
in fontconfig (`rgba=none`, `hintstyle=hintnone`, `antialias=true`, `lcdfilter=none`), which also
covers a browser server started from it (`pxsig browser start`).

`capture.launchArgs` adds arguments after these, so a later value of the same switch wins
(`--font-render-hinting=full`). Each render records the arguments in its environment
(`browser.launchArgs`, a major field), so changing them reads as an environment mismatch until the
baselines are re-rendered. A browser server (`capture.browserEndpoint`) launches its own browser
with its own arguments, and Firefox and WebKit take none of these; both record `[]`.
