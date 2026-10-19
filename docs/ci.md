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
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
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
      - uses: actions/cache/restore@v4
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

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: pxsig
          path: |
            pxsig-report
            ${{ env.STORE }}/reports/summary.md
            ${{ env.STORE }}/reports/junit.xml
            ${{ env.STORE }}/diffs/latest

      - uses: actions/cache/save@v4
        if: github.event_name == 'push'
        with:
          path: ${{ env.STORE }}/reports
          key: pxsig-reports-${{ github.sha }}
```

Notes on the example:

- `check --full` exits 1 when an entry changed, is new, or failed to render, which fails the job.
  The later steps use `if: always()` so the report is still uploaded.
- `--since origin/<base>` selects the entries affected by the files changed since the merge base,
  plus any uncommitted files. A change under an "affects every entry" path (a workspace dependency's
  source, `affects.extra`, the project config) selects everything.
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

## Render environment

Fonts and font rendering differ between operating systems. The signature gate absorbs
anti-aliasing noise, but a different fallback font is a real visual change. Approve baselines from
renders made in the same environment as CI (for example the same container image), or make sure
the fonts a story uses are loaded by Storybook rather than taken from the system.

## Exit codes

| Command | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `pxsig check --full` | pass | changed, new or render error | setup error |
| `pxsig doctor --ci` | no error-severity codes | error-severity codes | setup error |
| `pxsig report` | written | dashboard not built, or no project | |
