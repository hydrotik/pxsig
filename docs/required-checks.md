# Required checks and the merge queue

`pxsig check --full` as a required status check: a pull request cannot merge while a story renders
differently from its approved baseline. [ci.md](ci.md) covers the job itself (Storybook build,
carry-forward, reports). This page covers making it required, and running it in a merge queue.

## What fails the job

| Step | Exit 0 | Exit 1 | Exit 2 |
| --- | --- | --- | --- |
| `pxsig check --full` | every selected entry passes (a pass on retry is `flaky`, and passes) | an entry changed, is new (no baseline), or failed to render | setup error: no manifest, Storybook unreachable or broken, missing binary, store locked by another writer |
| `pxsig approve verify` | every baseline matches its last logged approval | a baseline's bytes differ from its last logged approval (written outside the log) | setup error |
| `pxsig doctor --ci` | no error-severity integrity code | an error-severity code | setup error (no manifest, broken Storybook index, unknown project) |

None of these commands needs a person. The ones that write baselines refuse to run in CI (`CI`
set), when output is piped, or under a coding assistant's marker: `approve apply` and `check --full --update` exit
3 (see [cli.md](cli.md#commands-that-need-a-person)). CI never writes baselines.

`approve verify` does not fail on baselines with no log line at all (from before the log existed).
It lists them, and `pxsig approve verify --adopt` (a person, in a terminal) logs them as the
starting point.

## Always run, select inside the job

A required check must report on every pull request and every merge group. A workflow skipped by a
`paths:` filter reports nothing, and the check then waits forever ("Expected — Waiting for status
to be reported"). Run the workflow on every event, and decide inside the job how much to render.

- `pxsig affected --since <ref> --json` prints `entries` (a count) and `ids`. Zero means no story
  imports a changed file: the Storybook build and the render can be skipped. Skipped steps leave
  the job green.
- A pull request that changes only baselines (an approval commit) selects no entries through the
  import graph. When any `.psig` file changed, check the whole project, so the new baselines are
  compared with renders from the job.
- `approve verify` and `doctor --ci` need no Storybook build. Run them every time.

## GitHub Actions example

One project, `ui`, with its Storybook in `apps/storybook` (as in [ci.md](ci.md)). The job is
named `pxsig`; that name is the required check.

```yaml
name: visual
on:
  pull_request:
  merge_group:
  push:
    branches: [main]

jobs:
  pxsig:
    name: pxsig
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

      # The base to diff against: the PR's base branch, the merge group's base commit, or none
      # (a push to main checks everything).
      - name: Select
        id: select
        run: |
          case "${{ github.event_name }}" in
            pull_request) base="origin/${{ github.base_ref }}" ;;
            merge_group)  base="${{ github.event.merge_group.base_sha }}" ;;
            *)            base="" ;;
          esac
          if [ -z "$base" ] || git diff --name-only "$base"...HEAD -- '*.psig' | grep -q .; then
            echo "since=" >> "$GITHUB_OUTPUT"
            echo "render=true" >> "$GITHUB_OUTPUT"
          else
            n=$(npx pxsig affected --project ui --since "$base" --json | jq .entries)
            echo "since=$base" >> "$GITHUB_OUTPUT"
            echo "render=$([ "$n" -gt 0 ] && echo true || echo false)" >> "$GITHUB_OUTPUT"
          fi

      - name: Approval log
        run: npx pxsig approve verify --project ui

      - if: steps.select.outputs.render == 'true'
        run: pnpm exec playwright install --with-deps chromium

      - if: steps.select.outputs.render == 'true'
        run: pnpm --dir apps/storybook exec storybook build --output-dir storybook-static

      - uses: actions/cache/restore@v6
        with:
          path: ${{ env.STORE }}/reports
          key: pxsig-reports-${{ github.sha }}
          restore-keys: pxsig-reports-

      - name: Check
        if: steps.select.outputs.render == 'true'
        run: |
          since="${{ steps.select.outputs.since }}"
          npx pxsig check --full --project ui \
            --storybook-static apps/storybook/storybook-static \
            ${since:+--since "$since"}

      - name: Integrity
        if: always()
        run: npx pxsig doctor --ci --offline --project ui

      - name: Static report
        if: always() && steps.select.outputs.render == 'true'
        run: npx pxsig report --project ui --out pxsig-report

      - uses: actions/upload-artifact@v7
        if: always() && steps.select.outputs.render == 'true'
        with:
          name: pxsig
          path: |
            pxsig-report
            ${{ env.STORE }}/reports/summary.md
            ${{ env.STORE }}/reports/junit.xml
            ${{ env.STORE }}/reports/check.json
            ${{ env.STORE }}/diffs/latest

      - uses: actions/cache/save@v6
        if: github.event_name == 'push'
        with:
          path: ${{ env.STORE }}/reports
          key: pxsig-reports-${{ github.sha }}
```

Notes:

- `--since` takes any git ref or commit. It diffs from the merge base with `HEAD`, so a base commit
  works the same as a branch name.
- `doctor --offline` reads the static scan instead of fetching a Storybook index, so it also runs
  when the render was skipped.
- `if: always()` keeps the report and the integrity step running after a failed check.

## Artifacts

| Path | What it is for |
| --- | --- |
| `pxsig-report/` (`pxsig report --out`) | The dashboard as static files with the images. Open `index.html`. |
| `<store>/reports/summary.md` | The PR comment (`gh pr comment <n> --body-file …`). |
| `<store>/reports/junit.xml` | One test case per entry, for a JUnit viewer. |
| `<store>/reports/check.json` | Every row, for scripts. |
| `<store>/diffs/latest/` | Diff images of the entries that failed. |

`pxsig report` exits 2 when it cannot write the report (no project, no dashboard build). The report
is for review; the check's exit code is the verdict.

## Branch protection

On the protected branch (a branch protection rule or a ruleset):

| Setting | Value |
| --- | --- |
| Require status checks to pass before merging | on; add `pxsig` (the job name) |
| Require branches to be up to date before merging | on, or use the merge queue instead |
| Require a pull request before merging | on |
| Require review from Code Owners | on, with `CODEOWNERS` over the baseline paths ([codeowners.md](codeowners.md)) |
| Dismiss stale pull request approvals when new commits are pushed | on |
| Require merge queue | optional (below) |
| Do not allow bypassing the above settings | on |

Give the required job a name no other workflow uses. Two jobs named `pxsig` report under one
name, and the rule cannot tell them apart.

## Merge queue

- **Trigger on `merge_group`.** A required check that does not run for the merge group never
  reports there, and the queue removes the pull request when it times out.
- **The base is the group's.** On `merge_group`, `github.base_ref` is empty. Use
  `github.event.merge_group.base_sha`. The group's head holds every pull request ahead in the
  queue, so the check covers them together.
- **Baselines conflict, they do not merge.** The store's `.gitattributes` marks `*.psig` binary,
  so a baseline changed in two pull requests is a conflict for the second one. It updates its
  branch, renders again and approves again.
- **The approval log conflicts at its end.** Two pull requests that each append to
  `approvals.ndjson` conflict at the last line. Keep both sets of lines, the base's first.
- **Renders come from the runner.** Baselines approved on a developer machine must render the same
  on the runner. See [ci.md](ci.md#render-environment).
