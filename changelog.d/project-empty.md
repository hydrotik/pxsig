### Added

- **`pxsig doctor` reports `project-empty`.** A setup warning for a project with no stories (none
  in its story index, none in its manifest), naming the likely cause: a package registered as a
  project that is not one, such as a dashboard adapter. `integrity.severity['project-empty']`
  changes its severity.
