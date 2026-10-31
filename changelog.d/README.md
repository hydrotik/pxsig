# Changelog fragments

Every pull request that changes something a user can notice adds one file here instead of editing
`CHANGELOG.md`, so open pull requests never edit the same file. A release merges them into
`CHANGELOG.md` and deletes them ([docs/releasing.md](../docs/releasing.md#the-changelog)).

- **Name:** `<topic>.md`, lower case, with digits, dots and dashes (`windows-paths.md`).
- **Content:** one or more `### <Heading>` sections, each a list, written like the entries in
  `CHANGELOG.md`. Headings, in the order a release prints them: `Breaking changes`,
  `Behaviour changes`, `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`,
  `Documentation`, `Not yet`.
- **Breaking changes** lists anything that removes or renames a command, flag, export, config key,
  HTTP endpoint or field, changes a default, or refuses input that used to work.
- **Behaviour changes** lists anything else that changes existing output, exit codes or files
  written.
- **To update:** every entry under those two headings ends with a line that starts `To update:`:
  what a consumer does about it, or `nothing to do` and why. `changelog.mjs check` fails an entry
  without one; a release collects them into "Upgrading from <previous version>" at the top of its
  section ([docs/releasing.md](../docs/releasing.md#the-changelog)).

```markdown
### Breaking changes

- **`--foo` is removed.** What changed and why.
  To update: pass `--bar` instead.

### Fixed

- **Short summary.** What changed, why, and what a user does about it.
```

A pull request that changes shipped code (`packages/*/src/`, the Storybook addon's own
`packages/storybook-addon/*.mjs` and `*.cjs`, `crates/*/src/`) must add a fragment. When a user
cannot notice the change (a refactor, a test), put the line `Changelog: none` in one of its commit
message bodies instead; `node scripts/changelog.mjs check --since origin/main` checks this.

`node scripts/changelog.mjs check` validates the fragments (CI runs it); `node scripts/changelog.mjs
preview` prints the next release's section.
