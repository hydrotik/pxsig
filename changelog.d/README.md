# Changelog fragments

Every pull request that changes something a user can notice adds one file here instead of editing
`CHANGELOG.md`, so open pull requests never edit the same file. A release merges them into
`CHANGELOG.md` and deletes them ([docs/releasing.md](../docs/releasing.md#the-changelog)).

- **Name:** `<topic>.md`, lower case, with digits, dots and dashes (`windows-paths.md`).
- **Content:** one or more `### <Heading>` sections, each a list, written like the entries in
  `CHANGELOG.md`. Headings, in the order a release prints them: `Behaviour changes`, `Added`,
  `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, `Documentation`, `Not yet`.
- **Behaviour changes** lists anything that changes existing output, exit codes, defaults or files
  written, with what to do about it.

```markdown
### Fixed

- **Short summary.** What changed, why, and what a user does about it.
```

A pull request that changes shipped code (`packages/*/src/`, the Storybook addon's own
`packages/storybook-addon/*.mjs` and `*.cjs`, `crates/*/src/`) must add a fragment. When a user
cannot notice the change (a refactor, a test), put the line `Changelog: none` in one of its commit
message bodies instead; `node scripts/changelog.mjs check --since origin/main` checks this.

`node scripts/changelog.mjs check` validates the fragments (CI runs it); `node scripts/changelog.mjs
preview` prints the next release's section.
