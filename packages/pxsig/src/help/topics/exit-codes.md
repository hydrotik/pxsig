# Exit codes

| Code | Meaning |
| --- | --- |
| 0 | OK |
| 1 | Problems found: changed entries (`check`), stale verdicts (`stale`), integrity findings (`doctor`), a migration that differs (`migrate`), a baseline that does not match its approval or has none, or a rewritten log (`approve verify`) |
| 2 | Usage or setup error: unknown command or project, no project chosen, no manifest, Storybook unreachable or broken, missing binary, the store locked by another writer, a failed `report` |
| 3 | Needs a person at a terminal: refused when piped, in CI, or under an assistant's marker (the message names it) |

Over several projects (`--all`), the worst exit wins. Each command's page (`pxsig help <command>`)
lists its own exits.
