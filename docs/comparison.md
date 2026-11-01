# pxsig and Chromatic

As of November 2026. Chromatic's side is taken from its own documentation and pricing pages
([docs](https://www.chromatic.com/docs/), [pricing](https://www.chromatic.com/pricing),
[billing](https://www.chromatic.com/docs/billing)); check them for anything that has changed since.
pxsig's side is in this repository's docs.

## What both do

|                                                    | pxsig                                                                          | Chromatic                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------- |
| Visual tests of Storybook stories                  | yes                                                                            | yes                              |
| Review each change side by side, approve or reject | the local dashboard (`pxsig serve`)                                            | a web app                        |
| Check only what a change touched                   | `pxsig affected`, `check --since` ([ci.md](ci.md#how-selection-decides))       | TurboSnap                        |
| Accessibility (axe)                                | a gate against a committed ledger ([configuration.md](configuration.md))       | accessibility tests              |
| Several browsers and viewports                     | Chromium, Firefox and WebKit through Playwright, in modes                      | Chrome, Firefox, Safari and Edge |
| Interaction states                                 | hover, focus, click and keys declared on the story (`parameters.pxsig.states`) | runs Storybook play functions    |
| Storybook addon                                    | `@pxsig/storybook-addon` ([storybook.md](storybook.md))                        | yes                              |
| Gate a pull request in CI                          | exit codes, JUnit and a Markdown summary ([ci.md](ci.md))                      | yes                              |

## Only in pxsig

- **Everything stays local.** It renders on your machines and in your CI, so no screenshots or code
  are uploaded and no account is needed.
- **No per-snapshot cost.** Chromatic bills each snapshot, and every extra browser or viewport adds
  snapshots.
- **Baselines live in the repository.** They follow branches, rebases and squash merges like code,
  and approvals show up in the pull request's diff.
- **Approvals have an audit trail.** Each approval records the file's hash before and after, can be
  undone, and is checked in CI.
- **`pxsig doctor`** reports what a passing check does not cover: stories with no entry, entries
  never checked, orphans ([integrity.md](integrity.md)).
- **A pinned container image** gives the same pixels on every machine, and each render records the
  environment it was made in ([container.md](container.md)).
- **Coding assistants** (MCP) can check, inspect and reject, but never approve
  ([agents.md](agents.md)).
- **The dashboard can be rebuilt on your own design system** ([ui/build-adapter.md](ui/build-adapter.md)).

## Only in Chromatic

- **Rendering is done for you.** Cloud browsers run in parallel, with no browsers on your own
  machines or CI.
- **It publishes your Storybook**, with shareable links.
- **Web review for the whole team.** People who do not run the code, such as designers and product
  managers, can review in a browser, with assigned reviewers, discussions and accounts with roles.
- **Visual tests from end-to-end suites:** Playwright, Cypress and Vitest tests. pxsig checks
  Storybook stories only.
- **Storybook play functions** run before capture. pxsig captures the interaction states a story
  declares instead.

## Change selection: `pxsig affected` and TurboSnap

Both follow the changed files through the import graph to the stories they reach, and both check
everything when they cannot be sure.

|                                    | pxsig                                                                                                                                                        | TurboSnap                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| The graph                          | read from the source: imports, re-exports, `require`, dynamic `import()`, `import.meta.glob`, CSS `@import` and `url()`, `tsconfig` paths, package `exports` | the bundler's own graph, from the Storybook build                                                   |
| Aliases only a bundler knows       | listed in `affects.aliases`; until then unresolved, which selects more                                                                                       | resolved by the bundler                                                                             |
| What counts as changed             | commits since the merge base, and staged, unstaged and untracked files                                                                                       | commits since the build it compares against                                                         |
| A path it cannot trace             | selects everything, and names the path and its class                                                                                                         | a change to `package.json`, the lockfile, the Storybook config or the static files tests everything |
| A dependency upgrade               | selects everything, unless the lockfile is in `affects.ignore`                                                                                               | can be narrowed to the stories that use the package                                                 |
| A changed baseline or store record | selects exactly its own entries                                                                                                                              | not applicable: baselines are in the cloud                                                          |
| What is left out                   | keeps its previous result, recorded as unaffected and not yet verified                                                                                       | its snapshot is copied forward and billed at a fifth of a capture                                   |
| Where it runs                      | `check --since`, `pxsig affected`, `serve --watch` and the MCP tools                                                                                         | Chromatic builds                                                                                    |
