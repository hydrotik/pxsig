### Documentation

- **The spec says what changes a format's version.** `docs/spec.md` gains "Versioning": each
  format's version (the spec v1 record, the `.psig` container, the manifest), what is additive at
  the same version (a new optional key or `.psig` section, which readers ignore or skip), what needs
  a new version, and that exit codes and verdict states are closed lists whose change is a breaking
  change. A test pins the versions and both lists to the code and the spec. What the engine and
  the CLI pass each other is an internal protocol of one release, held together by the version
  check (`engine-old`) and the CLI's refusal of rows without the color rule, not a public format.
