# Specification

This document defines the formats pxsig reads and writes: the spec v1 signature record, the
metrics and the gate, the `.psig` baseline container, and the manifest. The Rust crate
`pxsig-core` implements it; `crates/pxsig-core/src/record.rs` and `psig.rs` hold the serde models.

## 1. Signature record (spec v1)

A signature is a `grid x grid` RGB thumbnail of a render, plus hashes. Its record is a JSON object:

```jsonc
{
  "tool": "pxsig",
  "version": 1,
  "config": { "grid": 64, "channels": 3, "encoding": "base64-rgb-row-major", "alphaFlatten": "white" },
  "source": "button--primary.png",     // file name of the render it was built from
  "srcWidth": 412,                      // render size before downsampling
  "srcHeight": 96,
  "ahash": "f0f0e0c0c0e0f0f0",          // 64-bit average hash, 16 hex digits
  "dhash": "0c0c1c3c3c1c0c0c",          // 64-bit difference hash, 16 hex digits
  "sha256": "…",                        // sha256 of the raw signature bytes, hex
  "createdAt": "2026-10-18T12:00:00.000Z",
  "sig": "<base64>",                    // grid*grid*3 bytes, row-major RGB
  "detail": { … }                       // optional: the detail channel (section 3)
}
```

| Field                   | Type    | Meaning                                                                             |
| ----------------------- | ------- | ----------------------------------------------------------------------------------- |
| `tool`                  | string  | Always `"pxsig"`. A record with another value is rejected.                          |
| `version`               | integer | Spec version. Always `1`. A record with another value is rejected.                  |
| `config.grid`           | integer | Cells per side. At least 8; the engine clamps to 8..256.                            |
| `config.channels`       | integer | Always `3` (RGB).                                                                   |
| `config.encoding`       | string  | Always `"base64-rgb-row-major"`.                                                    |
| `config.alphaFlatten`   | string  | Always `"white"`.                                                                   |
| `source`                | string  | The render's file name. Informational.                                              |
| `srcWidth`, `srcHeight` | integer | The render's size in pixels.                                                        |
| `ahash`, `dhash`        | string  | Perceptual hashes (section 2).                                                      |
| `sha256`                | string  | sha256 of the decoded signature bytes. Equal hashes mean identical signatures.      |
| `createdAt`             | string  | ISO 8601 time the record was written.                                               |
| `sig`                   | string  | base64 of `grid * grid * 3` bytes. Its decoded length must match `grid`.            |
| `detail`                | object  | Optional. Absent when the detail channel is off, so such a record is plain spec v1. |

A standalone record is stored as `<id>.pxsig.json`. pxsig still reads that form. New baselines are
written as `.psig` containers (section 5), which hold the same record and the same signature bytes.

## 2. Signature construction

1. Decode the render (PNG) to RGBA.
2. Split it into `grid x grid` cells. Cell `(gx, gy)` covers columns `gx*w/grid` to
   `(gx+1)*w/grid` and rows `gy*h/grid` to `(gy+1)*h/grid`, at least one pixel each.
3. Flatten every pixel onto white: `c * a + 255 * (1 - a)` per channel, with `a` in 0..1.
4. Average each channel over the cell and round to a byte. The result is `grid*grid*3` bytes,
   row-major RGB.
5. Grayscale for metrics and hashes: `0.299 R + 0.587 G + 0.114 B` per cell.
6. **aHash**: box-resize the grayscale grid to 8x8; a bit is 1 where the value is at least the mean.
   64 bits, written as 16 hex digits, most significant bit first.
7. **dHash**: box-resize to 9x8; a bit is 1 where a cell is brighter than its left neighbour.
8. **sha256** of the signature bytes, hex.

Before a signature is built, the full check crops each render to its content, on the right and
bottom only (`trim`, section 4 of [configuration.md](configuration.md)). The top-left origin is kept
so a layout shift still moves pixels relative to the frame.

**Adaptive grid.** With `minCellPx` set, a baseline's grid is `ceil(max(width, height) / minCellPx)`,
kept between 16 (or `grid`, if smaller) and `grid`. Small components then get cells of at least
`minCellPx` pixels instead of pixel-sized cells. A story that sets its own `grid` skips this. A
comparison always uses the grid stored in the baseline.

## 3. Detail channel

A coarse grid averages away thin features: a 1 px border, an icon, a stroke. The detail channel is
a sparse, full-resolution addition to the record.

- The render is cut into 16 px tiles, counted from the top-left.
- Each tile keeps its **edge energy**: the mean absolute luminance gradient, one byte.
- Tiles whose energy is at least 10 also keep their luminance averaged into 4 px blocks.

`detail` in the record holds `tile`, `block`, `cols`, `rows`, and base64 strings `energy` (one byte
per tile), `sel` (little-endian u32 indices of the kept tiles) and `blocks` (block luminances).

When both the baseline and the gate have a detail channel, a comparison counts:

- **changed tiles**: kept tiles where any block moved by more than `blockDelta`;
- **new-edge tiles**: tiles whose energy rose by more than `energyDelta`.

The gate fails when `changedTiles + newEdgeTiles >= minTiles`.

## 4. Metrics and gate

A comparison decodes the current render, builds its signature at the baseline's grid, and
computes these metrics from the two signatures:

| Metric                         | Definition                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `ssim`                         | Mean SSIM over 8x8 windows, stride 4, on the grayscale grids. `C1 = (0.01*255)^2`, `C2 = (0.03*255)^2`. Rounded to 4 places. |
| `matchScore`                   | `ssim * 100`, rounded to 3 places.                                                                                           |
| `colorDiffPct`                 | Mean per-cell RGB delta, as a percentage of 255.                                                                             |
| `edgeDiffPct`                  | Mean absolute difference of the two Sobel gradient-magnitude maps, as a percentage of `4 * 255`.                             |
| `maxCellDiff`                  | The largest per-cell mean RGB delta.                                                                                         |
| `changedCells`                 | Cells whose mean RGB delta is above `threshold`.                                                                             |
| `changedCellsPct`              | `changedCells` as a percentage of all cells.                                                                                 |
| `psnr`                         | Luminance PSNR in dB; `"inf"` when identical.                                                                                |
| `ahashHamming`, `dhashHamming` | Bit differences between the hashes.                                                                                          |
| `identical`                    | The current signature's sha256 equals the baseline's.                                                                        |
| `grid`, `threshold`            | The grid and cell threshold used.                                                                                            |

### Gate

An entry **fails** when any rule trips. Each tripped rule adds a line to `reasons`.

| Key                  | Rule                                         | pxsig default | Engine built-in |
| -------------------- | -------------------------------------------- | ------------- | --------------- |
| `minSsim`            | `ssim < minSsim`                             | 0.99          | 0.99            |
| `maxChangedPct`      | `changedCellsPct > maxChangedPct`            | 2             | 2               |
| `threshold`          | per-cell delta that counts a cell as changed | 24            | 12              |
| `minCells`           | `changedCells >= minCells` (0 turns it off)  | 3             | 0               |
| `maxEdgePct`         | `edgeDiffPct > maxEdgePct`                   | off           | off             |
| `detail.blockDelta`  | see section 3                                | 32            | 32              |
| `detail.energyDelta` | see section 3                                | 48            | 48              |
| `detail.minTiles`    | see section 3                                | 3             | 3               |

"pxsig default" is the `gate` in the built-in project config, which every run sends to the engine.
"Engine built-in" applies only when the `pxsig` binary runs without a manifest gate.
`detail: false` turns the detail rule off; `detail: true` turns it on with the defaults.

### Gate resolution

For each entry the engine starts from its built-ins, then layers, last one winning:

1. the run's `gate` (the project config, see [configuration.md](configuration.md));
2. the gate environment variables (`PXSIG_THRESHOLD`, `PXSIG_MIN_SSIM`, `PXSIG_MAX_CHANGED_PCT`,
   `PXSIG_MAX_EDGE_PCT`, `PXSIG_MIN_CELLS`);
3. gate flags given to the `pxsig` binary (`--threshold`, `--min-ssim`, …, `--no-detail`);
4. the entry's own `gate` (from `parameters.pxsig.gate` on the story).

A story's gate is written next to the story it judges, so nothing run-wide overrides it: a
variable or a flag only changes the entries that do not set that value themselves. Unset or
unparsable variables are ignored.

The resolved gate is recorded on each result row, so a verdict can be explained later.

### Verdicts

| State                  | Meaning                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `pass`                 | The gate held and SSIM is 1.                                                          |
| `drift`                | The gate held, but SSIM is below 1.                                                   |
| `changed`              | The gate failed. Needs review.                                                        |
| `flaky`                | Failed, then passed on a fresh render (`--retries`). Reported, does not fail the run. |
| `new`                  | No baseline yet. Needs a person to approve its first render. Counts as failed.        |
| `error`                | The render failed (timeout, missing selector, Storybook error page).                  |
| `approved`, `rejected` | A review decision on the current result. A new verdict clears it.                     |
| `skipped`              | Not selected by this run; its previous row is carried forward.                        |

### Exit codes

| Code | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| 0    | Pass                                                                |
| 1    | At least one entry changed, is new, or failed to render             |
| 2    | Usage, setup, IO or validation error                                |
| 3    | The `pxsig` CLI needs a person at a terminal (see [cli.md](cli.md)) |

The `pxsig` binary uses 0, 1 and 2. The `pxsig` CLI adds 3.

## 5. The `.psig` container, version 1

One file per baseline: the record, the raw signature bytes and, optionally, the baseline image.

### Byte layout

| Offset | Size | Content                                                  |
| ------ | ---- | -------------------------------------------------------- |
| 0      | 4    | Magic `PSIG` (ASCII)                                     |
| 4      | 2    | Container version, u16 little-endian. Currently `1`.     |
| 6      | 4    | Header length `N` in bytes, u32 little-endian            |
| 10     | N    | Header: UTF-8 JSON (pretty-printed, ends with a newline) |
| 10 + N | …    | Sections, in the order of the header's `sections` array  |

### Header

```jsonc
{
  "format": "psig",
  "container": 1,
  "entry": { "id": "button--primary@dark", "story": "button--primary", "mode": "dark", "state": null },
  "env": { "v": 1, "id": "3f9c0a1b2c3d4e5f", "browser": { "name": "chromium", "version": "141.0.7390.37", … }, … },
  "record": { "tool": "pxsig", "version": 1, "config": { … }, … },   // the spec v1 record without "sig"
  "encryption": "none",
  "sections": [
    { "name": "sig", "length": 12288, "sha256": "…" },
    { "name": "image", "type": "image/png", "length": 20511, "sha256": "…", "width": 412, "height": 96 }
  ]
}
```

| Field        | Meaning                                                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`     | Always `"psig"`.                                                                                                                                                                                                                                                                                                    |
| `container`  | Container version, the same number as bytes 4..6.                                                                                                                                                                                                                                                                   |
| `entry`      | Optional. The manifest entry the baseline belongs to: `id`, `story`, `mode`, `state`.                                                                                                                                                                                                                               |
| `env`        | Optional (0.5 and later). The environment the baseline's render was made in, `v` 1: browser, OS, font probe, render settings, versions, and `id` over the major fields ([configuration.md](configuration.md#env)). Always the render's, never the approving machine's. A baseline without it compares as `unknown`. |
| `record`     | The spec v1 record, without `sig`.                                                                                                                                                                                                                                                                                  |
| `encryption` | `"none"`. Reserved: encryption is not implemented, and a reader refuses any other value.                                                                                                                                                                                                                            |
| `sections`   | One object per section: `name`, `length` in bytes, `sha256` hex of its bytes. The image section adds `type`, and `width` / `height` read from the PNG header.                                                                                                                                                       |

### Sections

| Name    | Content                                                | Required |
| ------- | ------------------------------------------------------ | -------- |
| `sig`   | The raw signature: `grid * grid * 3` bytes, not base64 | Yes      |
| `image` | The baseline render, PNG bytes, unchanged              | No       |

Sections follow the header back to back, in table order. pxsig writes `sig` first, then `image`.

### Reading rules

A reader must:

1. check the magic and refuse any container version it does not know;
2. refuse any `encryption` other than `"none"`;
3. for each section in the table, check its length and sha256; a mismatch is an error;
4. skip sections whose name it does not know, so later versions can add sections, and ignore
   top-level header keys it does not know (`env` to a reader older than 0.5);
5. require a `sig` section, and check that it matches the record (`grid * grid * 3` bytes).

Putting the `sig` bytes back into the record as base64 gives the exact spec v1 record the
container was packed from. `pxsig pack` checks that by reading every file back after writing it.

### Writing rules

- A `.psig` is written to a temporary file and renamed into place.
- `pxsig attach` adds an image to a container that has none. It refuses a container that already
  has one, and verifies that the record and signature bytes are unchanged afterwards. It keeps
  every top-level header key it does not write itself (`env`, and any key a later version adds).
- `pxsig baseline --env @file` writes each entry's render environment as `env`. The file is
  `{ "envs": { "<envId>": env }, "byId": { "<entryId>": "<envId>" } }`; an entry it does not name
  gets no `env`.

## 6. Manifest, version 2

Each project's store holds `manifest.json`, and one `manifest.<suite>.json` per suite. A manifest
lists entries only. Settings (grid, gate, viewport, modes) come from the resolved config at run
time, so the two cannot disagree.

```json
{
  "version": 2,
  "project": "ui",
  "stories": [
    {
      "id": "button--primary",
      "story": "button--primary",
      "mode": "light",
      "state": null,
      "sig": "packages/ui/.pxsig/baselines/Button/button--primary.psig",
      "importPath": "packages/ui/src/Button/Button.stories.tsx",
      "globals": "",
      "colorScheme": "light",
      "viewport": [900, 600],
      "browser": "chromium",
      "a11y": true
    }
  ],
  "skipped": [{ "id": "button--playground", "reason": "tag 'no-pxsig'" }]
}
```

### Entry id

```
<storyId>[__<state>][@<mode>]
```

- `storyId` is Storybook's story id, for example `button--primary`.
- `__<state>` is added for an interaction state from `parameters.pxsig.states`, for example
  `button--primary__hover`.
- `@<mode>` is added for every mode except the default mode, for example `button--primary@dark`.
  Entries in the default mode keep the bare id, so adding modes later does not rename baselines.

The server and the MCP server accept ids that match
`^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$`. Name states and modes with lowercase
letters, digits and hyphens.

### Entry keys

| Key           | Meaning                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `id`          | Entry id (above). Also the render's file name: `<id>.png`.                                        |
| `story`       | Storybook story id.                                                                               |
| `mode`        | Mode name (see `modes` in [configuration.md](configuration.md)).                                  |
| `state`       | Interaction state name, or `null`.                                                                |
| `sig`         | Baseline path, relative to the workspace root.                                                    |
| `importPath`  | The story file, relative to the workspace root.                                                   |
| `globals`     | Storybook globals for the mode, as in the `globals` URL parameter (`theme:dark;density:compact`). |
| `colorScheme` | `light` or `dark`, emulated by the browser.                                                       |
| `viewport`    | `[width, height]` in CSS pixels.                                                                  |
| `browser`     | `chromium`, `firefox` or `webkit`.                                                                |
| `grid`        | Story override of the signature grid.                                                             |
| `gate`        | Story gate override (section 4).                                                                  |
| `detail`      | `false` when the story turns the detail channel off.                                              |
| `ignore`      | CSS selectors masked before every capture.                                                        |
| `interaction` | The state's action: `{ name, action, target?, key?, waitFor?, fullPage? }`.                       |
| `delay`       | Extra settle time in ms.                                                                          |
| `target`      | The element to capture, when not the project's `capture.target`.                                  |
| `play`        | `true` when the story has a play function.                                                        |
| `a11y`        | `false` skips the axe pass for this entry.                                                        |

`skipped` lists stories left out by `parameters.pxsig.disable` or the `no-pxsig` tag, with the
reason. `pxsig manifest` rebuilds the file from the running Storybook. Existing entries keep their
`sig` path.

## 7. Run output

A full check writes, under `<store>/reports/`:

| File                                | Content                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check.json` (`check-<suite>.json`) | `{ generatedAt, project, suite, manifest, summary, affected, envs, rows }`, one row per entry. `envs` maps every render environment a row names (its render's `env`, its baseline's `baselineEnv`) by id; each row adds `envMatch` (`same`, `compatible`, `mismatch`, `unknown`) and, when not `same`, `envDiff` (the differing field names); `summary.envMismatch` counts the mismatched rows |
| `summary.md` (`summary-<suite>.md`) | Markdown summary, suitable for a pull request comment                                                                                                                                                                                                                                                                                                                                          |
| `junit.xml` (`junit-<suite>.xml`)   | JUnit results, one test case per entry                                                                                                                                                                                                                                                                                                                                                         |
| `history.ndjson`                    | One line per run (full checks and server re-checks)                                                                                                                                                                                                                                                                                                                                            |
| `integrity.json`                    | The integrity ledger (see [integrity.md](integrity.md))                                                                                                                                                                                                                                                                                                                                        |

Renders go to `<store>/renders/latest/<id>.png`; diff images for failures to
`<store>/diffs/latest/`.
