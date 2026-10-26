# Baseline owners (CODEOWNERS)

A baseline change is a file change, so the code host's review rules apply to it. With the
baselines in one folder per component, a `CODEOWNERS` file can require the owning team's review
for every baseline that team owns. pxsig needs no setup for this.

## Where baselines live

The component folder is the story file's folder relative to the project's `srcRoot`. Stories
outside `srcRoot` go under `_`. See [monorepo.md](monorepo.md#store-layout).

| `store.layout` | Baseline path | Glob for one component |
| --- | --- | --- |
| `package` (default) | `<project>/.pxsig/baselines/<component>/<id>.psig` | `/<project>/.pxsig/baselines/<component>/` |
| `colocated` | `<project>/<srcRoot>/<component>/__pxsig__/<id>.psig` | `/<project>/<srcRoot>/<component>/__pxsig__/` |

A pattern that ends in `/` matches everything below that folder, so a component's nested states
and modes are covered.

## Files shared by a whole store

Each store also has files that every approval touches, whatever the component:

| File | Changes when |
| --- | --- |
| `<store>/approvals.ndjson` | every approval appends a line |
| `<store>/manifest.json`, `<store>/manifest.<suite>.json` | a story is added, removed or renamed |
| `<store>/a11y.json` | an approval or an accessibility decision changes the accepted violations |
| `<store>/a11y-decisions.ndjson` | an accessibility decision is logged |
| `<project>/pxsig.config.json` | the gate, modes or Storybook settings change |

GitHub requires one approving review from an owner of **each** owned file. If the shared files
named one team only, every baseline change in the store would need that team as well. List every
team that approves baselines in the store on these files: a review from any one of them then
covers them.

`pxsig.config.json` is different: a looser gate passes changes that no baseline records. Give it
the team that owns the gate, not every team.

## Roles

CODEOWNERS is the control for who may approve a baseline change: map each role to the paths it
owns.

| Role | Owns | Why |
| --- | --- | --- |
| A component's team | that component's baseline folder | approves its own visual changes |
| Every team that approves in the store | `approvals.ndjson`, the manifests, `a11y.json`, `a11y-decisions.ndjson` | every approval touches them |
| The gate's owner (a design system or platform team) | `pxsig.config.json`, `pxsig.workspace.json`, `CODEOWNERS` | a looser gate passes changes no baseline records |
| The CI owner | the workflow that runs `pxsig check` and `pxsig approve verify` | removing a step removes the check |

## Example: two teams in one monorepo

A workspace with two projects. `packages/ui` uses the `package` layout, `packages/forms` the
`colocated` one. The design team owns the store as a whole; the forms team owns its components.

```
# .github/CODEOWNERS
# Later lines win. Put broad rules first and component rules after them.

# Every pxsig file in a store: the design team by default.
/packages/ui/.pxsig/                             @org/design-team
/packages/forms/.pxsig/                          @org/design-team
/packages/forms/src/**/__pxsig__/                @org/design-team

# Files every approval touches: either team may review them.
/packages/ui/.pxsig/approvals.ndjson             @org/design-team @org/forms-team
/packages/ui/.pxsig/manifest*.json               @org/design-team @org/forms-team
/packages/ui/.pxsig/a11y*                        @org/design-team @org/forms-team
/packages/forms/.pxsig/approvals.ndjson          @org/design-team @org/forms-team
/packages/forms/.pxsig/manifest*.json            @org/design-team @org/forms-team
/packages/forms/.pxsig/a11y*                     @org/design-team @org/forms-team

# Component baselines.
/packages/ui/.pxsig/baselines/Button/            @org/design-team
/packages/ui/.pxsig/baselines/DataTable/         @org/forms-team
/packages/forms/src/TextField/__pxsig__/         @org/forms-team

# The gate and the owners file itself.
/packages/*/pxsig.config.json                    @org/design-team
/pxsig.workspace.json                            @org/design-team
/.github/CODEOWNERS                              @org/design-team
```

A pull request that changes `baselines/DataTable/*.psig` and appends to `approvals.ndjson` then
needs one approving review from `@org/forms-team`. A change to `baselines/Button/` needs
`@org/design-team`. [`examples/monorepo/.github/CODEOWNERS`](../examples/monorepo/.github/CODEOWNERS)
routes the example workspace the same way.

## Branch protection

CODEOWNERS only routes review requests until the branch requires it. On the protected branch (a
branch protection rule or a ruleset):

| Setting | Why |
| --- | --- |
| Require a pull request before merging | baselines change only through a reviewed PR |
| Require review from Code Owners | the owner's review becomes a merge condition |
| Dismiss stale pull request approvals when new commits are pushed | a review covers the baselines it saw, not ones pushed after |
| Require approval of the most recent reviewable push | the person who pushed the last baselines cannot be their only reviewer |
| Do not allow bypassing the above settings | administrators follow the same rule |

Required status checks and the merge queue are in [required-checks.md](required-checks.md).

## What this guarantees, and what it does not

The PR review is the authority for a baseline change. pxsig's approval log is the record of what
changed and why: entry, reason, batch, git HEAD, and the sha256 before and after.

It guarantees:

- A baseline file under an owned folder does not reach the protected branch without an approving
  review from one of its owners.
- With `pxsig approve verify --since <base>` as a required check, a PR fails (exit 1) when a
  baseline's bytes differ from its last logged approval, when a baseline has no log line at all,
  or when the log was rewritten rather than appended to. See [required-checks.md](required-checks.md).

It does not guarantee:

- **Who approved in pxsig.** The log names no person by default (`by` only with
  `approvals.identity: "git-email"`, and then self-asserted). `pxsig approve log --trace` points
  each approval at the commit that added it and the pull request that merged it; the code host's
  review is the identity that counts.
- **That the reviewer looked at the images.** The PR shows a binary file or, with the `psig` diff
  driver, its header. The images are in the dashboard (`pxsig serve`) or the static report from CI
  (`pxsig report`).
- **That a change was caught.** A looser gate in `pxsig.config.json` or in a story's
  `parameters.pxsig.gate` passes changes without touching a baseline. Own the config files, and
  review story files as code.
- **Ownership after a move.** Moving a component to a new folder moves its baselines to a new path.
  Update `CODEOWNERS` in the same PR.
- **A record after a squash merge.** The review stays in the host's PR history, not in git. The log
  line and its hashes are in git.

Approvals themselves are a person's: in the dashboard, or with `pxsig approve` in a terminal. The
server refuses an agent or a script that posts to it. See [server.md](server.md#guards) and
[SECURITY.md](../SECURITY.md).
