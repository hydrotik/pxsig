### Added

- **`"react": { "compiler": "oxc" }`: the compiler analysis without Babel.** The engine has a
  built-in React Compiler, `oxc_react_compiler` 0.143.0 (the React Compiler's Rust port,
  experimental), and `react.compiler: "oxc"` runs the analysis with it: no
  `babel-plugin-react-compiler` or `@babel/core` needed, several times faster, in an engine process
  of its own, so a file that crashes the compiler is a `compiler-error` and the others still
  compile. It answers each component and hook as the Babel analysis does (compiled with its memo
  cache size, skipped and why, opted out, a compiler error), and the alerts, `react.json`, the
  dashboard and `pxsig_react` keep their shape. It follows the React Compiler's main branch, so it
  can differ from the released Babel plugin on a few functions: a project that builds with the
  Babel plugin keeps the default. `react.compiler: "babel"` names the Babel plugin, which `"auto"`
  (the default) still means. The engine also answers `pxsig react-compile` directly.

### Behaviour changes

- **Each React analysis names its compiler.** `pxsig react` prints a `compiler:` line
  (`babel-plugin-react-compiler 1.0.0 with @babel/core 7.29.7`, or `oxc_react_compiler 0.143.0
  (built-in, experimental)`); `pxsig doctor`'s `react-compiler` finding says which compiler a run
  would use and why; `pxsig_react`'s `backend` adds `name` and `label`; the React SARIF file
  names the compiler as its tool extension; `react.json`'s `backend.name` is `babel` or `oxc`, and
  `backend.babel` is null for `oxc`.
  To update: nothing to do for a project that keeps the default; a script that matched the
  doctor line `babel-plugin-react-compiler <v> with @babel/core <v>` exactly matches its start.
- **The published engine is about 3 MB larger** (the built-in compiler, cargo feature
  `react-oxc`, now in every release build and in the engine's SBOM).
  To update: nothing to do.
