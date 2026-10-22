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
| `nonVisual` | `[]` | Top-level folders under `srcRoot` with no visual stories. Their stories are not entries and are reported as `excluded`. |
| `a11y` | `true` | Run axe on every render. |
| `integrity` | `{}` | Integrity options (below). |
| `dashboard.ui` | none | A UI adapter for `pxsig dashboard build` and `gaps`: a path to its module, relative to this folder (see [ui/build-adapter.md](ui/build-adapter.md)). The prebuilt dashboard does not read it. |

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
| `PXSIG_DASHBOARD_DIR` | server, `report` | A dashboard built by `pxsig dashboard build`, served instead of the prebuilt one. |
| `PXSIG_UI_ADAPTER` | dashboard build | The UI adapter, by built-in name or path; above `dashboard.ui`. |
| `PXSIG_AGENT` | CLI | Set to mark the shell as an agent: plain output, and commands that need a person are refused. |
| `PXSIG_NO_DELEGATE` | CLI | Do not hand over to the workspace root's install (see [monorepo.md](monorepo.md#installs)). |
| `PXSIG_THREADS` | binary | Worker threads for batch commands. Default: logical CPUs. |
| `PXSIG_THRESHOLD`, `PXSIG_MIN_SSIM`, `PXSIG_MAX_CHANGED_PCT`, `PXSIG_MAX_EDGE_PCT`, `PXSIG_MIN_CELLS` | binary | Gate values above the project's `gate` and below the gate flags and every story's own gate (see [spec.md](spec.md#gate-resolution)). |
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
