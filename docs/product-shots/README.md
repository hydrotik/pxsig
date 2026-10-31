# Product shots

Screenshots of pxsig for the README and the docs. This is the only folder where images may be
committed (`scripts/check-clean.mjs` allows png, jpg, webp, avif and gif here and nowhere else).

## What belongs here

- Screenshots of pxsig itself: the dashboard, the Storybook addon, the CLI.
- Shot from demo data: the projects in `examples/`, never a real design system or app. No names
  from other repositories, no home paths, no host names in the frame.
- Compressed losslessly, at most 1.5 MB each (the README loads them; check-clean fails a larger
  one). Aim for under 1 MB.
- Never baselines, renders, diffs, stores or fonts: those belong to the project under test.

A shot that shows a staged or mocked state, rather than a real run on an example, says so here.

## Re-shooting

```bash
PXSIG_DS_SOURCE=<design-system checkout> pnpm build:dashboard   # see packages/dashboard/README.md
node scripts/showcase-shots.mjs
```

`scripts/showcase-shots.mjs` serves the built dashboard with mock data: a design system in the
middle of a review (`scripts/lib/showcase-data.mjs`: 42 entries, changes, new stories, render and
coverage errors, an accessibility violation, stale entries, 14 runs). The card the inspector
compares is rendered by the script, before and after a change. It shoots the light theme at
1560×1000 CSS px and 2x, crops the Overview to its content and the inspector to its dialog,
compresses the PNGs with `oxipng` or `zopflipng` when one is installed, and records the version
in `shots.json`. The data is mocked; the dashboard is the real build. Every minor or major release
re-shoots them on its release branch ([releasing.md](../releasing.md#product-shots)); the release
fails when `shots.json` names another minor. `--serve` keeps the mock dashboard running for shots
by hand.

`scripts/product-shots.mjs` shoots a real run instead: the `examples/single-package` project checked,
changed and checked again (`--approve-manually` waits for a person to approve its first renders
through the dashboard link, so the approval log is real too).

## Files

| File            | What it shows                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overview.png`  | The README hero: the Overview mid-review — status cards, Open Items, the Errors card with the safe repairs, the stale-entries heatmap, Changed Entries per Run |
| `inspector.png` | The review's first change: a project card, baseline and latest render side by side, the changed regions boxed and listed, and the metrics that failed the gate |
| `shots.json`    | The version the shots were taken at (`scripts/check-shots.mjs` reads it)                                                                                       |
