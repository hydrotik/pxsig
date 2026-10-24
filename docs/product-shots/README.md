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
cargo build --release
PXSIG_DS_SOURCE=<design-system checkout> pnpm build:dashboard   # see packages/dashboard/README.md
node scripts/product-shots.mjs
```

The script copies `examples/single-package` to `.local/` (git-ignored), records its baselines,
widens the Button's padding, checks again and starts `pxsig serve` on that copy. It then shoots
each view at 1600×1000 CSS px and 2x in both themes, and compresses the PNGs with `oxipng` or
`zopflipng` when one is installed. Every shot is a real run: nothing is mocked.

`--keep` leaves the server running and prints its URL; `--url <that URL> --raw` shoots again from it
without the setup or the compression, which is the quick way to try a different view.

## Files

Named `<view>.png`. The current two were captured by hand from the kitchen-sink demo (the example
project with a run history, changes awaiting review, a new story, a render error, stale entries and
an accessibility violation — all from real checks), light theme, at 2x. `scripts/product-shots.mjs`
reproduces a simpler version of both from the example.

| File | What it shows |
| --- | --- |
| `overview.png` | The README hero: the Overview mid-review — status cards, Open Items, the stale-entries heatmap, the Errors card with the safe repairs, and Changed Entries per Run |
| `inspector.png` | The inspector on a changed card: baseline and latest render side by side, changed pixels and detail tiles highlighted, the changed regions, and the metrics that failed the gate |
