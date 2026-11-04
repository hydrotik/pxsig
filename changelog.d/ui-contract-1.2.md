### Added

- **UI contract 1.2.0: `Switch` and `Slider` take `disabled`.** A disabled control stays visible
  and announced, and does not change. An adapter written for contract 1.1.0 keeps working: while a
  control is disabled the dashboard draws it with the built-in fallback. See
  docs/ui/contract-changes.md.
