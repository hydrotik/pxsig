### Behaviour changes

- **`@pxsig/storybook-addon`: `storybook` is an optional peer dependency.** npm 7 and later
  installed the newest Storybook with the addon when the project had none, and with it Storybook's
  bundlers (esbuild, oxc-parser, oxc-resolver and their per-platform binaries); a supply-chain
  scanner or a package procurement service resolving the addon alone counted all of them. The
  addon has no dependencies of its own and runs inside the project's Storybook, so now installing
  it installs nothing else. The peer range is unchanged (`>=10`), and npm still reports a
  Storybook outside it.
  To update: nothing, for a project that has Storybook. A setup that installed the addon on its
  own to get Storybook installs `storybook` itself: `npm install -D storybook`.
