# @pxsig/dashboard

The source of the pxsig dashboard: a React app that `pxsig serve` and `pxsig report` serve. This
package is private. Its build goes into the `pxsig` package, so users get the dashboard prebuilt.

## Building

The dashboard renders through a UI contract (`src/ui/`, see [its README](src/ui/README.md)): views
import components from `@ui`, and a UI adapter chosen at build time supplies them. With nothing
set, the build uses the built-in `plain` adapter (semantic HTML and one stylesheet), which builds
from a clone of this repository alone.

The prebuilt dashboard in the `pxsig` package uses the reference adapter, `hydrotik`, built on the
author's design system, `@hydrotik/design-system`, which is not published to npm. The build
compiles it, its tokens and its theme provider from a local checkout of the monorepo that contains
them; setting `PXSIG_DS_SOURCE` makes `hydrotik` the default:

```bash
pnpm --filter @pxsig/dashboard build                                      # plain
PXSIG_DS_SOURCE=<path to the design-system monorepo> pnpm --filter @pxsig/dashboard build
PXSIG_UI_ADAPTER=<name or path> pnpm --filter @pxsig/dashboard build   # another adapter
```

The order is `PXSIG_UI_ADAPTER`, then `dashboard.ui` in a `pxsig.config.json` in the folder the
command runs from, then `hydrotik` when `PXSIG_DS_SOURCE` is set, then `plain`
(`build-config.mjs` `adapterSpec`).

The build writes a single classic script plus `index.html` to `packages/pxsig/dist/dashboard/` (or
`PXSIG_DASHBOARD_OUT`), so a static report also opens from disk. That folder is git-ignored and
ships only in the published `pxsig` package.

The script is not minified, so the copy in the npm package can be read and audited as it ships.
`PXSIG_DASHBOARD_MINIFY=1` at build time minifies it (smaller, harder to read); the same variable
applies to `pxsig dashboard build`.

Without a build, `pxsig serve` still answers its API, and `/report/` answers 404 with "the
dashboard is not built". Changes to the data the dashboard reads (`packages/pxsig/src/report.mjs`)
and to the server can be developed and tested without it.

## Sample data and screens

`fixtures/scenarios.mjs` holds the sample report data (named scenarios: `clean`, `changed`,
`first-approval`, `errors`, `a11y`, `flaky`, `stale`, `empty`, `several-projects`, and the server
states `loading`, `load-error`, `offline`, `static`). The browser tests (`test/flows.test.mjs`) and
`pxsig dashboard check` both use it. Each feature in `src/ui/features.ts` lists the screens the
check renders; `node scripts/ui.mjs docs` writes them to `fixtures/screens.json`, which ships in
the `pxsig` package (Node cannot strip types from a `.ts` file under `node_modules`).

## Copy

Every user-facing string is in `src/copy/en.json`, keyed by view (`overview.items.changed`,
`inspector.review.approve`, …). Views read it with `t(key, vars)` for text and `tx(key, vars)` when
a placeholder holds a React node, such as a command in `<code>`; both are in `src/copy/index.tsx`.

- Placeholders are `{name}`. Numbers passed in are formatted for the locale.
- A message with a count can have plural forms, `{ "one": "…", "other": "…" }`, picked with
  `Intl.PluralRules`.
- Keys are typed from `en.json`: a key that does not exist fails the type check.
- Coverage statuses (`coverage.codes.<code>`) have a title and a help line; an unknown code shows
  as itself.

Style: sentence case, the state first and then the action, no questions, no second person, no
evaluative adjectives. Explanations belong in the Help section, not on working screens.

A translation is a sibling file with the same keys (`fr.json`) added to `LOCALES` in
`src/copy/index.tsx`; the browser's language picks it, and a missing key falls back to English.
Text that comes from the server (per-entry issue reasons, repair results, gate reasons) is not in
these files and stays in English.

## Data

Served, the app reads `/__pxsig/data?project=<name>` and listens to `/__pxsig/events`. A static
report inlines the same data in `index.html`. See [docs/server.md](../../docs/server.md).

MIT. Copyright (c) 2026 Hydrotik LLC.
