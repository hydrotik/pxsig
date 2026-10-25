# Checks without hosted CI

Some repositories have no hosted runner: no minutes, a private network, or a Storybook that only
builds on one machine. The workflow's steps can run on a machine instead, and report to the pull
request as a commit status. Branch protection treats a commit status like a check.

## The recipe

1. Check out the pull request's head commit in a clean worktree, not the working copy. `--since`
   also selects uncommitted files, and a render shows whatever is on disk.
2. Post a `pending` status on that commit.
3. Run the same steps as the CI job ([required-checks.md](required-checks.md)): install, build
   Storybook, `pxsig approve verify`, `pxsig check --full`, `pxsig doctor --ci`.
4. Post `success`, `failure` (exit 1: a visual change or a log mismatch) or `error` (exit 2: setup),
   and keep the reports.

Commit statuses go through the REST API: `POST /repos/{owner}/{repo}/statuses/{sha}` with
`state`, `context`, `description` (at most 140 characters) and an optional `target_url`. `gh api`
sends it with the signed-in user's token.

## Example script

For one project, `ui`, with its Storybook in `apps/storybook`. Run it from the repository's main
checkout.

```bash
#!/usr/bin/env bash
# visual-local.sh <pr>: run the visual check for a pull request on this machine
# and post the result as the commit status "local/pxsig".
set -uo pipefail
pr="$1"
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
sha=$(gh pr view "$pr" --json headRefOid -q .headRefOid)
base=$(gh pr view "$pr" --json baseRefName -q .baseRefName)
context="local/pxsig"
main=$PWD
out="${VISUAL_OUT:-$HOME/.cache/visual-local}/$sha"

status() { # state description
  gh api "repos/$repo/statuses/$sha" -f state="$1" -f context="$context" -f description="$2" >/dev/null
}

git fetch origin "$base" "pull/$pr/head" || exit 2
dir=$(mktemp -d)
git worktree add --detach "$dir" "$sha" || exit 2
trap 'cd "$main" && git worktree remove --force "$dir"' EXIT

status pending "running on $(hostname -s)"
cd "$dir"

step() { # name, command…: setup steps; any failure is an error status
  "${@:2}" || { status error "$1 failed"; exit 2; }
}
step install  pnpm install --frozen-lockfile
step storybook pnpm --dir apps/storybook exec storybook build --output-dir storybook-static

code=0
npx pxsig approve verify --project ui || code=$?
if [ "$code" -le 1 ]; then
  npx pxsig check --full --project ui \
    --storybook-static apps/storybook/storybook-static --since "origin/$base"
  c=$?; [ "$c" -gt "$code" ] && code=$c
fi
npx pxsig doctor --ci --project ui
c=$?; [ "$c" -gt "$code" ] && code=$c

mkdir -p "$out"
npx pxsig report --project ui --out "$out/report" >/dev/null
cp packages/ui/.pxsig/reports/summary.md packages/ui/.pxsig/reports/junit.xml "$out/" 2>/dev/null

case "$code" in
  0) status success "no visual changes" ;;
  1) status failure "visual changes or log mismatch: see the PR comment" ;;
  *) status error "setup error (exit $code)" ;;
esac
[ "$code" -eq 1 ] && gh pr comment "$pr" --body-file "$out/summary.md"
exit "$code"
```

Then require the status on the protected branch: under required status checks, add
`local/pxsig`. GitHub suggests the contexts reported in the last week, so run the script once
first.

## Notes

- **The status is for one commit.** A push to the pull request moves its head, and the required
  status is missing again until the script runs on the new head.
- **Anyone with write access can post a status.** The status says that a machine ran the steps.
  It is not proof. The review of the baselines is the authority ([codeowners.md](codeowners.md)).
- **Render on the machine that approves.** A different operating system or font set renders
  differently. Run the script where the baselines were approved, or in the same container image
  ([ci.md](ci.md#render-environment)).
- **A fresh worktree has no earlier results.** Entries the selection leaves out are recorded as
  `skipped-unaffected` (ok, not yet verified). To carry real verdicts forward, copy
  `<store>/reports/check.json` from the last run on the base branch into the worktree before the
  check.
- **No server needed.** The worktree is its own workspace, so a `pxsig serve` running for the main
  checkout keeps its store; the script never talks to it.
- **Merge queue.** A queue waits for statuses on the merge group's head commit, which only exists on
  the host for the queue's lifetime. A machine that polls for queued groups can run the same steps
  on them; otherwise use "Require branches to be up to date before merging" instead of a queue.
