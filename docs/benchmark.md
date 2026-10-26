# Scale benchmark

For maintainers. A nightly check that pxsig's read paths stay fast at the size of a real design
system: 1,074 entries in the main manifest, 1,668 in a matrix suite (2,742 baselines and renders),
168 story files with 537 stories, about 1,000 code files under `src`, a 3,000-line approval log
and a 442-run history. The sizes are hydrotik's on 2026-10-25 (`SIZE` in
`scripts/bench/generate-store.mjs`). No browser and no Storybook: render speed is measured on a
real project, not here.

```bash
cargo build --release
node scripts/bench/run.mjs                 # generate a store in a temporary folder, time, compare
node scripts/bench/run.mjs --keep          # …and keep the store to look at
node scripts/bench/generate-store.mjs DIR  # only the store (the same for the same --seed)
```

## What it times

Each step is a fresh `node` process, start-up included, as a person runs it. One warm-up run, then
the median of `--runs` (5).

| Step | Command | Budget |
| --- | --- | --- |
| affected | `pxsig affected --since HEAD~1` (an edited component, an edited shared module, one re-baselined entry, one log line) | 2 s |
| list | `pxsig list` | 3 s |
| doctor | `pxsig doctor --offline` | 3 s |
| plan | `pxsig approve plan --all-changed` (12 changed entries) | none: the 50% rule only |
| data | the dashboard's data, as `GET /__pxsig/data` builds and serialises it | 2 s |

A step fails when its median is over its budget, or more than 50% over the time
`scripts/bench/baseline.json` records for the same OS at the last release (a rise under 100 ms is
not counted: it is runner noise on a sub-second step). With no baseline for the OS, only the
budgets apply.

## Where it runs

`.github/workflows/bench.yml`: nightly at 03:30 UTC on Linux, and by hand (Actions → bench → Run
workflow). Never on pull requests. The table is on the run's summary page; the run uploads
`bench-results` (`bench-results.json`, in `baseline.json`'s shape). The Node CI job runs
`scripts/bench/run.test.mjs` on every OS: the generator and the pass/fail rule, not the timings.

## Refreshing the baseline

At each release, on the `release/X.Y.Z` branch: download `bench-results` from the latest nightly
run on `main` and commit it as `scripts/bench/baseline.json`. The file keeps the other OSes' times
and replaces Linux's. A macOS time can be refreshed the same way with
`node scripts/bench/run.mjs --out scripts/bench/baseline.json` on a Mac.
