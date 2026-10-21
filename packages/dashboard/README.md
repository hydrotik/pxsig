# @pxsig/dashboard

The source of the pxsig dashboard: a React app that `pxsig serve` and `pxsig report` serve. This
package is private. Its build goes into the `pxsig` package, so users get the dashboard prebuilt.

## Building

The dashboard is built on the author's design system, `@hydrotik/design-system`, which is not
published to npm. The build compiles it, its tokens and its theme provider from a local checkout of
the monorepo that contains them:

```bash
PXSIG_DS_SOURCE=<path to the design-system monorepo> pnpm --filter @pxsig/dashboard build
```

The build looks up each package by name under that checkout's `packages/` and `apps/` folders,
compiles their vanilla-extract styles from source, and writes a single classic script plus
`index.html` to `packages/pxsig/dist/dashboard/`, so a static report also opens from disk. That
folder is git-ignored and ships only in the published `pxsig` package.

Without a build, `pxsig serve` still answers its API, and `/report/` answers 404 with "the
dashboard is not built". Changes to the data the dashboard reads (`packages/pxsig/src/report.mjs`)
and to the server can be developed and tested without it.

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
