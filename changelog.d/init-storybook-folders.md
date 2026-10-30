### Behaviour changes

- **`pxsig init` records the package's Storybook folders.** A new `pxsig.config.json` gets
  `storybook.configDir: ".storybook"` when the folder has `.storybook/`, and
  `storybook.staticDir: "storybook-static"` when it has a `storybook-static/` folder; init lists
  what it recorded. A flag for the same key wins, and an existing config is never edited. Check
  the written config after `init`; to keep a key out, remove it there, or pass the flag with the
  path you want.

### Added

- **`pxsig init --storybook-static <dir>`** writes `storybook.staticDir`: a Storybook build that
  `manifest`, `check` and the server serve themselves when nothing answers at `storybook.url`, so
  pxsig works without a running Storybook. The `pxsig init` section of `docs/cli.md` has a
  three-line quick start.
