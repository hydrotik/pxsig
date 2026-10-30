# Exit codes

| Code | Meaning                                                                                                                                                                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | OK                                                                                                                                                                                                                                                                                                                                                       |
| 1    | Problems found: changed entries (`check`), stale verdicts (`stale`), integrity findings (`doctor`), a migration that differs (`migrate`), a baseline that does not match its approval or has none, or a rewritten log (`approve verify`). Also a typed confirmation that did not match, or an `a11y --prune` plan a decision made stale: nothing written |
| 2    | Usage or setup error: unknown command or project, no project chosen, no manifest, Storybook unreachable or broken, missing binary, the store locked by another writer, a failed `report`, and `check --strict-env` refusing baselines approved in a different render environment (nothing rendered)                                                      |
| 3    | Needs a person at a terminal (`check --full --update`, `approve apply`, `approve undo`, `approve verify --adopt`, `a11y --prune`, `doctor --repair --apply --prune`, `doctor --repair --only log-torn --apply`, `serve --link`): refused when piped, in CI, or under an assistant's marker (the message names it)                                        |

Warn mode: a gate the committed config sets to `warn` (`enforcement` in pxsig.config.json) exits
`enforcement.advisoryExit` (0 by default, or 10 to 125) where only it would have failed, and the
output says so in ADVISORY lines. Setup errors (2) and refusals (3) are never warned.

Over several projects (`--all`), the worst exit wins; an advisory exit never hides another
project's failure. Each command's page (`pxsig help <command>`) lists its own exits.
