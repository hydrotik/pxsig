# Continuous integration

In CI, pxsig renders a static Storybook build, checks it against the committed baselines, and
fails the job when something changed that nobody approved. Approving stays a human step, on a
developer's machine, in the dashboard.

## What a job needs

- The repository with full history, when you use `--since` (it needs the merge base).
- Node 20 or later, the workspace's dependencies, and Playwright's Chromium (plus Firefox or WebKit
  if a mode uses them).
- The `pxsig` engine binary. Once pxsig is published, the npm install brings the platform package.
  Until then, build it from a clone with `cargo build --release` and set `PXSIG_BIN` to
  `target/release/pxsig`.
- A Storybook the job can reach at the project's `storybook.url` (or `PXSIG_STORYBOOK_URL`). A
  static build served over HTTP works: it includes `index.json`.

## GitHub Actions example

A monorepo with one project, `ui`, whose Storybook lives in `apps/storybook`. Pull requests check
only what the change can affect; pushes to `main` check everything.

```yaml
name: visual
on:
  pull_request:
  push:
    branches: [main]

jobs:
  pxsig:
    runs-on: ubuntu-latest
    env:
      STORE: packages/ui/.pxsig
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium

      # Build only: nothing listens on storybook.url in CI, so pxsig serves this build itself
      # (storybook.staticDir, here given as a flag) on a free port.
      - name: Build Storybook
        run: pnpm --dir apps/storybook exec storybook build --output-dir storybook-static

      # The last full result from main, so entries a pull request does not touch
      # carry a result forward instead of reading as never checked.
      - uses: actions/cache/restore@v6
        with:
          path: ${{ env.STORE }}/reports
          key: pxsig-reports-${{ github.sha }}
          restore-keys: pxsig-reports-

      - name: Check
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            npx pxsig check --full --project ui --storybook-static apps/storybook/storybook-static --since origin/${{ github.base_ref }}
          else
            npx pxsig check --full --project ui --storybook-static apps/storybook/storybook-static
          fi

      - name: Integrity
        if: always()
        run: npx pxsig doctor --ci --project ui

      - name: Static report
        if: always()
        run: npx pxsig report --project ui --out pxsig-report

      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: pxsig
          path: |
            pxsig-report
            ${{ env.STORE }}/reports/summary.md
            ${{ env.STORE }}/reports/junit.xml
            ${{ env.STORE }}/diffs/latest

      - uses: actions/cache/save@v6
        if: github.event_name == 'push'
        with:
          path: ${{ env.STORE }}/reports
          key: pxsig-reports-${{ github.sha }}
```

Notes on the example:

- `check --full` exits 1 when an entry changed, is new, or failed to render, which fails the job.
  The later steps use `if: always()` so the report is still uploaded.
- `--since origin/<base>` selects the entries affected by the files changed since the merge base,
  plus any uncommitted files ([How selection decides](#how-selection-decides)). A path the
  selection cannot trace selects everything, and the job log and `summary.md` say which.
- `--storybook-static` (or `storybook.staticDir` in the config) points at the build. When nothing
  answers at `storybook.url`, the check serves that folder itself on a free port, so the job needs
  no static server of its own and no fixed port.
- Entries a run does not select carry their previous result from `<store>/reports/check.json`. On
  a fresh runner that file does not exist: an unselected entry that has a baseline is then
  recorded as unaffected, and `pxsig doctor` reports it as `skipped-unaffected` (info: ok, not yet
  verified), not as `never-checked`. The cache step above is still worth having: it keeps real
  verdicts and their ages in the PR report. `doctor --fail-on info` would fail on those entries;
  `--ci` (errors only) does not.
- After a checkout every file looks recently edited, so carried results can show as `stale`. That
  is a warning; `--ci` fails on errors only.
- `pxsig doctor --ci` exits 1 on any error-severity code, 2 on a setup error such as a broken
  Storybook index.

[required-checks.md](required-checks.md) makes the job a required check and runs it in a merge
queue. [local-ci.md](local-ci.md) runs the same steps on a machine without hosted CI.

## How selection decides

`check --since <ref>`, `check --changed <files>`, `pxsig affected` and the MCP tools
`pxsig_affected` and `pxsig_check` select entries from the changed files. The rule: **when the
selection is unsure, it selects everything, and says why.**

The changed files are the commits since the merge base of `<ref>` and `HEAD`, plus staged,
unstaged and untracked files. A rename counts both its old and its new path. Paths are relative to
the workspace root; a path elsewhere in the repository is `$repo/<path>`. When git finds no merge
base (a shallow clone: fetch with `fetch-depth: 0`), every entry is selected, with a warning.

Each changed path gets one class, by the first row that matches:

| Class | The path | Selects |
| --- | --- | --- |
| `affects-all` | is under an "affects every entry" path: a workspace dependency's source, `affects.extra`, the project config, the workspace file, `storybook.configDir` | all |
| `baseline` | is an entry's `.psig` | that entry |
| `baseline-other` | is another `.psig`: another suite's (run `--suite <name>`) or orphaned | nothing here |
| `store-record` | is `a11y.json`, a manifest, `approvals.ndjson` or `a11y-decisions.ndjson` in the store | the entries whose records changed; all when a log was rewritten or a file does not parse |
| `store-other` | is any other file in the store | all |
| `graph` | is a file a story file imports, directly or not (below) | those entries; all when an "affects every entry" file imports it |
| `graph-no-entry` | is a module that no story reaches (a test, a script) | nothing |
| `ignored` | matches `affects.ignore` | nothing |
| `untraced` | is under `srcRoot` and nothing imports it (an unimported `.json`, `.md`, image) | all |
| `outside` | is outside `srcRoot`, in the workspace | all |
| `outside-workspace` | is elsewhere in the repository | all |

The last three are the fail-safe. `pxsig affected` prints one line for each; the `check` line and
`summary.md` name the first (`All N entries selected: <path> (<class>)`). A path that never
changes a render (docs, other apps, CI config) belongs in `affects.ignore`
([configuration.md](configuration.md)). An ignore entry never hides a path in the rows above it.

After upgrading, run `pxsig affected --since origin/main` on a few recent pull requests: every
`outside` line is a candidate for `affects.ignore`, and every unresolved import for
`affects.aliases` or `affects.unresolved`.

### What counts as an import

The graph holds every file under `srcRoot`, every "affects every entry" folder (so an import in
the Storybook config counts: `preview.tsx` importing `src/global.css.ts` makes that file select
all), every `affects.aliases` target, and the source folder of each workspace package an import
reaches. pxsig reads:

- **Code** (`.ts .tsx .mts .cts .js .jsx .mjs .cjs .mdx`): `import … from`, `export … from`,
  `import '…'`, `import('…')`, `require('…')`, `new URL('…', import.meta.url)`,
  `import.meta.glob('…')` (every file the pattern matches), `require.context('dir')` (every file
  under it), and `url(…)` in strings (a vanilla-extract `fontFace` source).
- **Style sheets** (`.css .scss .sass .less .pcss`): `@import`, `@use`, `@forward`, `composes … from`
  and `url(…)`.
- Any file type can be imported: `.json`, `.svg`, `.md?raw`, fonts, images. `?query` and `#hash`
  suffixes are ignored. A template literal (`` import(`./icons/${name}.svg`) ``) stands for every
  file under its folder that ends the same way.

A specifier resolves, in this order:

1. A relative path: the file, `<path>.<ext>`, `<path>/index.<ext>`, and the TypeScript source for
   a `.js` name (`./a.js` → `a.ts`).
2. A Node built-in (`node:fs`, `path`): external.
3. `affects.aliases`: aliases only a bundler knows (Vite `resolve.alias`).
4. `compilerOptions.paths` and `baseUrl` of the nearest `tsconfig.json`, following `extends`.
5. `#…` through the nearest `package.json` `imports`.
6. A package: the project itself or a workspace package (linked in `node_modules`), through
   `exports` (conditions `source`, `development`, `import`, `default`, `require`), else `main`.
   A target in a build output (`dist/`) maps back to its source file
   (`dist/a/index.mjs` → `src/a/index.ts`), or to the whole source folder when none matches.
7. Any other installed package: external. A remote URL (`https://…`) is listed as `remote`: no
   change here reflects it, and a full check covers it.

Anything else is **unresolved**: a `virtual:` module, an alias pxsig does not know, a computed
`import(x)`, a subpath `exports` does not list. An unresolved import adds the entries that reach
its file to **every** run, and all of them when that file affects every entry (it is then a
fail-safe line, class `unresolved`). `pxsig affected` lists each one with its file and line. Map
a bundler alias in `affects.aliases`, or accept the file in `affects.unresolved`
([configuration.md](configuration.md)): for example a Storybook `main.ts` whose computed import
only loads a docs page script.

`pxsig serve --watch` and staleness (`doctor`, `pxsig_stale`) are not gates: they use the traced
selection (`traced` in `affected --json`: no fail-safe and no unresolved imports) and print what
they could not trace.

## Reports

| File | Use |
| --- | --- |
| `<store>/reports/junit.xml` | Test results, one case per entry, for any JUnit viewer |
| `<store>/reports/summary.md` | A Markdown summary for a pull request comment. `--link-base <url>` on the check links each entry to a hosted report. |
| `<store>/reports/check.json` | Every row, for scripts |
| `pxsig report --out <dir>` | The dashboard as static files, with the images. Open `index.html` from the artifact. |

To post the summary on the pull request, for example:

```bash
gh pr comment "$PR_NUMBER" --body-file packages/ui/.pxsig/reports/summary.md
```

## Rebasing with baselines

A `.psig` file is binary, so git does not merge two versions of it: a rebase or merge that meets a
baseline changed on both sides stops with that file conflicted. `pxsig check` refuses to run, and
`pxsig doctor` reports `store-conflict`, until it is resolved. Neither side's baseline is right for
the merged code, so pxsig has no merge driver that would pick one without a person.

1. **Take main's baseline** for each conflicted `.psig`: `git checkout --ours <file>` during a
   rebase (there "ours" is the branch being rebased onto), `git checkout --theirs <file>` during a
   merge of main into the branch. Then `git add` it.
2. **The logs:** `approvals.ndjson` and `a11y-decisions.ndjson` conflict at their end. Keep both
   sides' lines, main's first, and drop the conflict markers.
3. **`a11y.json` and manifests** are JSON: keep both sides' keys and entries.
4. Finish the rebase, then run `pxsig check --since main`: the merged code renders against main's
   baselines.
5. **Approve again** what changed, in the dashboard or with `pxsig approve`. The new log lines go
   after main's, so `pxsig approve verify --since main` passes.

## Repository size

Baselines are committed with their images, typically a few to a few tens of kilobytes per entry,
and every approval adds a new version to the history. A store of a thousand entries in two modes is
tens of megabytes. That is fine for most repositories. Consider Git LFS for `*.psig` when clones
become slow: many modes or suites, large viewports, or frequent re-baselining. LFS changes how CI
fetches (`actions/checkout` with `lfs: true`), and a clone without LFS holds small pointer files
instead of baselines. Keep a suite git-ignored and local instead when only one machine needs it.

## Render environment

Fonts and font rendering differ between operating systems. The signature gate absorbs
anti-aliasing noise, but a different fallback font is a real visual change. Approve baselines from
renders made in the same environment as CI, or make sure the fonts a story uses are loaded by
Storybook rather than taken from the system. The pxsig container image
(`ghcr.io/hydrotik/pxsig:<pxsig>-pw<playwright>`) is that environment: CI runs the check in it, and
a Mac renders with its browser through `pxsig browser start` ([container.md](container.md)). Each
render records the environment it was made in, and a check warns when a baseline came from another
one ([configuration.md](configuration.md#env)).

## Exit codes

| Command | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `pxsig check --full` | pass | changed, new or render error | setup error |
| `pxsig approve verify` | every baseline matches its approval | a mismatch, an interrupted approval, a baseline with no log line (unless `--no-strict`), or with `--since` a rewritten log or no merge base | setup error |
| `pxsig doctor --ci` | no error-severity codes | error-severity codes | setup error |
| `pxsig report` | written | | dashboard not built, no project, or output not writable |
