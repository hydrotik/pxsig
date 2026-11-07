### Added

- **The engine has a built-in React Compiler, not used yet.** `pxsig react-compile` runs
  `oxc_react_compiler` 0.143.0, the React Compiler's Rust port, over a batch of files and answers
  each component and hook in the shape the Babel analysis uses: compiled (with its memo cache
  size), skipped and why, opted out, or a compiler error. A file that crashes the compiler is
  isolated as a compiler error; the others still compile. Nothing calls it yet: the compiler
  analysis still uses the project's `babel-plugin-react-compiler`. A later release adds the opt-in
  `"react": { "compiler": "oxc" }`. It is built only with the `react-oxc` cargo feature, which the
  published engines leave off until that release, so their size is unchanged.
