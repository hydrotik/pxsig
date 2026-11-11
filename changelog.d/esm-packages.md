### Behaviour changes

- **The Storybook addon and the platform packages are ES modules.** `@pxsig/storybook-addon` and
  every `@pxsig/cli-<platform>-<arch>` package now set `"type": "module"`, so registry scanners
  (Socket) no longer mark them "not ESM". The addon's preset is `preset.mjs`, with named exports;
  Storybook 10 imports it as before, under the same names (`@pxsig/storybook-addon` and
  `@pxsig/storybook-addon/preset`), and `require()` of it works on a Node that can require an ES
  module (22.12 or later, which Storybook 10 needs too). A platform package now has `index.js`
  (`export default` the binary's path) and `index.cjs` (the same path for `require`), chosen by an
  `exports` map; `bin/<exe>` and `package.json` stay resolvable by name, so pxsig finds its engine as
  before. Each platform package's self-test also checks that `import`, `require` and the `bin/`
  path give the same file, and pxsig's installed self-test resolves this host's engine package the
  way pxsig does.
  To update: nothing to do for `.storybook/main`, `import`/`require` of the package names, or a
  tool that resolves `@pxsig/cli-<platform>-<arch>/bin/<exe>`. A tool that loaded a platform
  package's `index.js` by its path imports or requires the package name instead.
