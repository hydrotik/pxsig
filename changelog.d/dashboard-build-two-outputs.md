### Behaviour changes

- **`pxsig dashboard build` writes two builds.** The output folder holds the served dashboard as
  ES-module chunks (`index.html`, `assets/app.js`, `assets/common-*.js` and a chunk per part loaded
  on first use) and, in `classic/`, one classic script that `pxsig report` copies into a static
  report. Its `pxsig-build.json` lists the build's files, and `pxsig serve` serves the prebuilt
  dashboard, with a note naming the command, while a listed file is missing. Adapters are
  unchanged: no contract change.
  To update: run `pxsig dashboard build` again after upgrading; a build from an earlier pxsig is
  not served (as before, on any version change). A tool that reads the build's
  `assets/app.js` as the whole dashboard reads `classic/assets/app.js` instead.
