# How pxsig works across a team

pxsig runs on each developer's computer. The repository is what is shared. There is no pxsig
server to deploy, no account and no upload.

## What is shared, and what stays on one machine

| Committed (shared through git)                                                 | On each machine (git-ignored)                                  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `pxsig.config.json`, `pxsig.workspace.json`                                    | renders, diffs and reports (`<store>/renders/`, `reports/`, …) |
| baselines (`<store>/baselines/` or `__pxsig__/` beside the components)         | `<store>/history/` (local copies for `approve undo`)           |
| the manifest, the approval log (`approvals.ndjson`), the a11y baseline and log | the server, its dashboard, its tokens and `server.json`        |

Baselines move between people the way code does: a commit, a pull request, a review, a merge, a
pull. Two people approving the same baseline meet as a git conflict, like any other file.

## The workflow

1. A developer changes a component and checks it (`pxsig check`, or `pxsig serve --watch` and the
   Storybook panel).
2. They review the change in their own dashboard and approve it. That writes the baseline and a
   line in the approval log: the time, the entry, colour or shape, the reason. No name.
3. They commit and open a pull request. [CODEOWNERS](codeowners.md) can require the owning team's
   review of each baseline; CI runs the check and `pxsig approve verify`, which fails on a baseline
   nobody approved ([ci.md](ci.md), [required-checks.md](required-checks.md)).
4. The pull request merges; teammates pull and have the new baselines. `pxsig approve log
   --trace` shows the commit and the pull request each approval came in by: git and the forge say
   who.

## Where pxsig runs

| Environment                   | pxsig's role                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A developer's computer or VDI | Checks, review, approval. Decisions are made here and nowhere else.                                                     |
| CI                            | The gate: checks against a built Storybook, verifies the approval log. Never approves.                                  |
| Shared dev, UAT, pre-prod     | None running. A deployed Storybook's pxsig panel is read-only: the [snapshot](#a-deployed-storybook) its build carries. |

The pxsig server answers only on `127.0.0.1`, only to requests addressed to this computer, and
accepts checks only from the Storybook in its own config ([server.md](server.md#guards)). A
Storybook served from another machine cannot reach it, by design: that site would otherwise reach
into each viewer's computer, and would show that computer's results beside a different commit's
stories.

## A deployed Storybook

`storybook build` with the addon writes `pxsig-snapshot.json` into the build (`pxsig snapshot`,
[cli.md](cli.md)), made from the committed store at the commit being built. On a Storybook not
served from this computer the panel makes no request to any pxsig server and shows the snapshot
for the current story:

- **Coverage:** each mode and state, whether it has a baseline, its last change (date, approved or
  first baseline), the pull request, colour or shape, the render environment, and the accepted
  axe rules.
- **History:** every change to the story's look, newest first, with its pull request and reason.

It never shows who approved, how, or any image. It always matches the stories on screen, since
both come from the same commit. In a shallow clone (a CI checkout at depth 1) no pull request is
shown rather than a wrong one; build with `fetch-depth: 0` to have them. Without a snapshot, the
panel says pxsig runs on a developer's computer and makes no connection. `snapshot: false` in the
addon's options leaves the file out ([storybook.md](storybook.md#on-a-deployed-storybook)).

## Why it works this way

- **Nothing leaves the machine that rendered it.** No account, no upload, no hosted service, so
  pxsig works offline and on locked-down machines.
- **Baselines are reviewed like code,** in the same pull request as the change that caused them,
  with an owner per component.
- **The approval trail is in git,** holds no personal data, and `approve verify` fails CI on a
  baseline nobody approved.
- **Every check names the environment it rendered in,** so a font or browser difference shows as
  an environment difference, not as a change to review; the [container image](container.md) gives
  every machine the same one.
- **A deployed Storybook carries its own history,** matched to its commit, readable by anyone who
  can open it.
