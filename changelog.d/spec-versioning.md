### Documentation

- **The spec says what changes a format's version.** `docs/spec.md` gains "Versioning": each
  format's version (the spec v1 record, the `.psig` container, the manifest), what is additive at
  the same version (a new optional key or `.psig` section, which readers ignore or skip), what needs
  a new version, and that exit codes and verdict states are closed lists whose change is a breaking
  change. A test pins the versions and both lists to the code and the spec.
