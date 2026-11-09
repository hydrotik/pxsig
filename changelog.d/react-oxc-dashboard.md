### Added

- **The dashboard names the React Compiler.** Diagnostics › React › Compiler's title names the
  compiler of the last analysis: "React Compiler (babel-plugin-react-compiler 1.0.0)", or "React
  Compiler (built-in, oxc 0.143.0, experimental)" for `react.compiler: "oxc"`, whose side panel
  shows no Babel row. With `"oxc"` the "not installed" message does not appear, since the built-in
  compiler needs no packages. Help › React Analysis has the compiler choice (`"auto"`, `"babel"`,
  `"oxc"`) and what "experimental" means.
