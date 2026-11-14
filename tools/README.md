# Research tools

Scripts that measure pxsig on a real project: whether the gate catches simulated regressions and ignores noise, which grid and gate rules the evidence supports, and how fast the engine and the renderer are. They write the JSON the dashboard's **Scenarios**, **Calibration** and **Performance** tabs show.

All pixel work goes through the Rust binary (`capture`/`baseline`, `check --json`, `compare`, `diff`, `trim`, `detail-sweep`, and the stdio daemon `pxsig serve`). The tools only pick inputs, call the engine and score its numbers. They never write a baseline: throwaway signatures go to a scratch folder, and any write aimed at `<store>/baselines/` or a `__pxsig__` folder is refused.

## Before you start

- The Rust binary is built (`cargo build --release`), or `PXSIG_BIN` points at one.
- The project has a manifest and approved baselines (`pxsig manifest`, `pxsig check`, then approve).
- Storybook is reachable at the project's `storybook.url`, or `PXSIG_STORYBOOK_URL` says where it is (needed by `scenarios.mjs` and the render part of `bench.mjs`).

Each tool takes `--project <name>` and `--workspace <dir>` and otherwise resolves the project from the current directory, like the `pxsig` CLI does.

## The tools

| Tool                   | What it measures                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Writes                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `scenarios.mjs`        | Re-renders the entries with one simulated change at a time (injected CSS, token overrides, another mode's globals) and checks each render against the committed baseline twice, with the shipped gate and with the whole-image signature alone. Regression scenarios report **recall** (failed / changed); noise scenarios report **false positives** (failed / entries). "Changed" means the pixels differ from the `control` render (Rust `diff`, tolerance 0). | `reports/scenarios[-<suite>].json`   |
| `calibrate.mjs`        | Re-scores the saved scenario renders at several signature grids (32 to 128) under candidate whole-image rules (`default`, `cells>=k@t`). A rule counts only if it raises no false positives on any noise scenario.                                                                                                                                                                                                                                                | `reports/calibration[-<suite>].json` |
| `calibrate-gate.mjs`   | Searches the whole gate (grid policy × cell threshold × ssim floor × changed % × min cells × detail rule) over every saved scenario render, all suites together, and reports the zero-false-positive gate that catches the most.                                                                                                                                                                                                                                  | `reports/calibration-gate.json`      |
| `calibrate-detail.mjs` | Holds the project's whole-image gate fixed and searches the detail channel: build (tile, block, selection energy) × rule (≥ k tiles with block Δ > T or energy rise > E).                                                                                                                                                                                                                                                                                         | `reports/calibration-detail.json`    |
| `gate-noise.mjs`       | The gate's false positives on renders of the same content: run to run on one machine and machine to machine on one OS, with today's rules, the color rule alone and the whole gate, and how close the same content comes to each rule. Needs no project of its own: it renders examples/single-package and the dashboard's fixture screens (see [Gate noise](#gate-noise)).                                                                                       | `--json` and `--summary` files       |
| `bench.mjs`            | Batch `check` by thread count, batch `baseline` into scratch, one `compare` per process against one daemon request, peak RSS, render throughput at 1, 2, 4 and 8 pages, binary size.                                                                                                                                                                                                                                                                              | `reports/bench.json`                 |

Run `scenarios.mjs` before the calibration tools, since they re-score its saved renders. `bench.mjs` needs only the latest renders from a `pxsig check`.

```sh
node tools/scenarios.mjs --project web                  # 17 built-in scenarios over every entry
node tools/scenarios.mjs --every 4 --modes light        # a sample: every 4th entry, one mode
node tools/scenarios.mjs --only tracking,subpixel       # re-run some; the rest stay from the last report
node tools/scenarios.mjs --rescore                      # re-check the saved renders after a gate change
node tools/calibrate.mjs [--grids 32,48,64,96,128] [--min-cell-px 8]
node tools/calibrate-gate.mjs [--min-cells-px 4,6,8]
node tools/calibrate-detail.mjs
node tools/bench.mjs [--runs 5] [--no-render] [--concurrency 1,2,4,8]
```

## Gate noise

`gate-noise.mjs` measures what the gate does with renders that should be the same, on the machines
that render them, before a default ships (docs/releasing.md). The **gate noise** workflow
(`.github/workflows/gate-noise.yml`, run by hand) runs it on GitHub's Linux, macOS and Windows
runners, two jobs per OS, and on a GPU runner when the dispatch names one.

```sh
node tools/gate-noise.mjs render --label macos-a --out noise/macos-a   # each suite, twice, on this machine
node tools/gate-noise.mjs compare --from noise --json report.json --summary summary.md
```

- **render** stages examples/single-package as `scripts/examples-test.mjs` does and renders it with
  `pxsig check --full` on an empty store, and renders the dashboard's fixture screens on the plain
  adapter with `pxsig dashboard check` (both themes; no design-system source). Each `--runs` times
  (default 2), into `<out>/<suite>/run<n>/`, with `meta.json` (the label, OS, architecture,
  Chromium, GPU class) and each suite's grid and gate.
- **compare** reads every folder with a `meta.json`. For each suite it pairs run 1 with run 2 of
  each machine, and run 1 of each two machines with the same OS and architecture. The first of a
  pair becomes a throwaway baseline in a temporary folder (`pxsig baseline`); the second is checked
  against it with today's rules (the gate without the color rule), with the color rule alone
  (every other rule opened wide, so it measures every row) at its own values and at two lower
  lines (ΔE00 2 and 1, cells 3 and 2), and with the whole gate. The tables give, per scenario, the
  renders that differ byte for byte, the false positives of each, the lowest SSIM, the most changed
  cells, the largest cell difference, the most detail tiles, and for the color rule the largest
  flat area and cell count at each line, so the margins are visible.

## Scenarios

The built-in scenarios are plain CSS, so they apply to any Storybook. `{target}` stands for the project's `capture.target`.

- **Regressions:** root font size, web-font fallback, hue shift, small-area color (a badge tint, a text color, a lost row highlight), corner radius dropped, inline padding lost, borders gone, icons hidden, letter-spacing, a 12px layout shift, and `mode-swap` (each entry rendered with the next mode's globals and colour scheme; only when the project has two or more modes).
- **Noise:** `control` (render again with no change), a 0.4px shift of the story content, opacity 0.99, and brightness(1.004), about one 8-bit step.

Add or replace scenarios with `--scenarios <file.json>`:

```json
{
  "replace": false,
  "scenarios": [
    {
      "name": "brand-color",
      "kind": "regression",
      "title": "Brand colour changed",
      "change": "primary → rose",
      "tokens": { "color-primary": "#e11d48" }
    },
    {
      "name": "bold",
      "kind": "regression",
      "title": "Weight bumped",
      "change": "font-weight 800",
      "css": "*{font-weight:800!important}"
    },
    {
      "name": "dense",
      "kind": "regression",
      "title": "Wrong density",
      "change": "density global",
      "globals": "density:compact"
    }
  ],
  "suites": {
    "charts": {
      "title": "Charts",
      "stories": "^charts-",
      "scenarios": [
        {
          "name": "strokes-thin",
          "kind": "regression",
          "title": "Strokes thinned",
          "change": "stroke-width 0.5",
          "css": "svg path{stroke-width:.5px!important}"
        }
      ]
    }
  }
}
```

- `css` is injected after the page loads.
- `globals` and `colorScheme` replace the entry's own.
- `tokens` maps a CSS custom-property prefix to a value and sets every `--<prefix>__*` variable (the hashed names CSS-in-TS libraries emit). A value is a literal, `{ "scale": 1.25 }` (multiplies the current value's leading number, unit kept) or `{ "mix": "#e11d48", "amount": 30 }` (mixes that share of the colour into the current value with `color-mix`). Nothing in a scenarios file is run as code; the former `"fn:<body>"` form is refused with a message.
- A scenario with a built-in name replaces that built-in, and `"replace": true` drops all the built-ins except `control`.
- `--suite <name>` renders every entry whose story id matches the suite's `stories` regex (no sampling), runs the base scenarios plus the suite's own, and writes `scenarios-<suite>.json`.

## Where output goes

| Path (under the project's store)    | Contents                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `reports/*.json`                    | The reports above                                                                                                               |
| `renders/<tag>/<scenario>/<id>.png` | Scenario renders, which the dashboard inspector opens (`tag` is `scenarios` or `scenarios-<suite>`)                             |
| `diffs/<tag>/<scenario>/`           | Diff artifacts for every scenario render                                                                                        |
| `cache/research/`                   | Scratch: baseline images taken out of the `.psig` files, throwaway signatures, manifests and benchmark renders. Safe to delete. |

All of these folders are git-ignored by the store's `.gitignore`.

## Reading the numbers

- **Recall is per changed render.** A scenario that changes no pixels in an entry (for example, `icons-missing` on a story without icons) does not count against it.
- **A noise false positive is a real finding.** It means the gate as configured would flag that drift on this project. The calibration tools show which grid or rule would not.
- **Fixed grids are noisy on small components.** A fixed grid on a small trimmed component gives cells only a few pixels wide, so `calibrate.mjs` with fixed grids can show false positives that the project's min-cell policy (`minCellPx`, which `calibrate-gate.mjs` searches) does not.
