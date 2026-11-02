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
node scripts/bench/run.mjs --against DIR   # …and time an installed pxsig (DIR = its package folder) in the same run
node scripts/bench/run.mjs --keep          # …and keep the store to look at
node scripts/bench/generate-store.mjs DIR  # only the store (the same for the same --seed)
```

## What it times

Each step is a fresh `node` process, start-up included, as a person runs it. One warm-up run, then
the median of `--runs` (5).

| Step     | Command                                                                                                              | Budget |
| -------- | -------------------------------------------------------------------------------------------------------------------- | ------ |
| affected | `pxsig affected --since HEAD~1` (an edited component, an edited shared module, one re-baselined entry, one log line) | 2 s    |
| list     | `pxsig list`                                                                                                         | 3 s    |
| doctor   | `pxsig doctor --offline`                                                                                             | 3 s    |
| plan     | `pxsig approve plan --all-changed` (12 changed entries)                                                              | 3 s    |
| data     | the dashboard's data, as `GET /__pxsig/data` builds and serialises it                                                | 2 s    |

A step fails when its median is over its budget, or, with `--against`, when it is more than 30%
slower than the last release's median from the same run ([below](#against-the-last-release)). More
than 50% over the time `scripts/bench/baseline.json` records for the same OS is a warning: the
table says `warn`, and on GitHub the run carries an annotation, but it does not fail. That baseline
is one nightly sample from another night, and shared runners differ by more than 50% from night to
night (on 2026-10-28 every step ran about 30% faster than the nights around it), so a rise under
100 ms is not counted against it either. With no baseline for the OS, only the budgets and the
same-run comparison apply.

## Against the last release

The nightly run installs the last release from npm (`pxsig@latest`, with its own engine from its
platform package) and times it in the same job, on the same store, alternating with `main` run by
run: one warm-up each, then `main`, release, `main`, release… So a slower stretch of the shared
runner slows both, and the comparison is between two medians taken minutes apart, not on different
nights.

The threshold is 30% (`RELEASE_RATIO`), and at least 25 ms (`RELEASE_FLOOR_MS`). Measured on
2026-11-02 (macOS, three full runs of `main` against 0.7.3 with the same engine binary): within one
run the two medians differed by at most 3.6% per step, while the same step moved by up to 11%
between runs (`affected` 314 → 280 ms). 30% leaves room for that spread several times over and
still catches a real slowdown. On the Linux runner, the two nightly runs with the release in the
same job (41392549344 and 41508925861) put `main` at most 1.6% slower than 0.7.3 on any step (`plan`, 513 against 505 ms).

The floor is for a step so fast that 30% of it is a few milliseconds of process start-up: it only
decides under about 83 ms (25 / 0.3). Above that, every step is held to 30%, `list` (about 100 ms on
Linux) included. Earlier the floor was a flat 100 ms, which let any step under about 333 ms rise
by more than 30%: `list` could nearly double (102 → 202 ms) without failing. A step the release
cannot run (a store format it does not read) is reported and not compared.

## In a release

The release does not run the benchmark. Its first job reads the newest completed nightly run on
`main` whose commit is the tagged one or an ancestor of it
(`scripts/bench/release-gate.mjs`), and that run's "Benchmark against the last release" step:

- **success:** the release goes on, and its summary names the run;
- **failure:** the release stops. Fix the slowdown, or re-run bench on `main` (Actions → bench →
  Run workflow) if it was the runner, then re-run the release;
- **no such run, or the step did not finish:** the release goes on with a warning, so a missing
  benchmark (a new repository, runs past their retention) never blocks a release for good.
- **a run too old to speak for the tag:** more than 7 days old at the release (`MAX_AGE_DAYS`), or
  more than 20 commits on `main` before the tagged one (`MAX_BEHIND`, counted along the first
  parent, so about one per merged PR). It counts as no run, whatever its result: the release goes on
  with a warning that says how to get a fresh one (`gh workflow run bench.yml --ref main`, or
  Actions → bench → Run workflow; then re-run the release). With the nightly schedule a run is
  normally less than a day old; dispatching one on the release commit just before tagging is the
  surest way to have the release gated on it.

The notice names the run, how long ago it ran and how many commits before the tag.

Only that step counts: the same job's advisory checks are `ci.yml`'s, which the tagged commit has
already passed. A dry run skips it.

## Where it runs

`.github/workflows/bench.yml`: nightly at 03:30 UTC on Linux, and by hand (Actions → bench → Run
workflow). Never on pull requests. The table is on the run's summary page; the run uploads
`bench-results` (`bench-results.json`, in `baseline.json`'s shape, with the release's times from
the same run under `release`). The Node CI job runs `scripts/bench/run.test.mjs` and
`scripts/bench/release-gate.test.mjs` on every OS: the generator, the pass/fail rules and the
release's reading of a run, not the timings.

## Refreshing the baseline

At each release, on the `release/X.Y.Z` branch: download `bench-results` from the latest nightly
run on `main` and commit it as `scripts/bench/baseline.json`. The file keeps the other OSes' times
and replaces Linux's. A macOS time can be refreshed the same way with
`node scripts/bench/run.mjs --out scripts/bench/baseline.json` on a Mac.
