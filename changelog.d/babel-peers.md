### Behaviour changes

- **`@babel/core` and `babel-plugin-react-compiler` are no longer optional peers of pxsig.** pxsig
  never used its own copy: the React Compiler analysis resolves both from the project, as before,
  and `pxsig doctor`, `check` and Diagnostics › React report them missing with the same messages.
  Package managers and supply-chain scanners no longer list them, or their dependencies, with
  pxsig.
  To update: nothing to do for a project that has them. A project that wants the Babel compiler
  analysis installs both itself, as before: `npm install -D babel-plugin-react-compiler @babel/core`.
