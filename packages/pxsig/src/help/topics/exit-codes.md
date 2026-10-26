# Exit codes

| Code | Meaning |
| --- | --- |
| 0 | OK |
| 1 | Problems found: changed entries (`check`), stale verdicts (`stale`), integrity findings (`doctor`), a migration that differs (`migrate`), a baseline that does not match its approval or has none, or a rewritten log (`approve verify`). Also a typed confirmation that did not match, or an `a11y --prune` plan a decision made stale: nothing written |
| 2 | Usage or setup error: unknown command or project, no project chosen, no manifest, Storybook unreachable or broken, missing binary, the store locked by another writer, a failed `report` |
| 3 | Needs a person at a terminal (`check --full --update`, `approve apply`, `approve undo`, `approve verify --adopt`, `a11y --prune`, `doctor --repair --apply --prune`, `serve --link`): refused when piped, in CI, or under an assistant's marker (the message names it) |

Over several projects (`--all`), the worst exit wins. Each command's page (`pxsig help <command>`)
lists its own exits.
