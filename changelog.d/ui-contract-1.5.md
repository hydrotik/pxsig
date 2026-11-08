### Added

- **UI contract 1.5.0: `TextField`**, an optional component with a fallback: a controlled
  single-line text input with a visible label (`label`, `value`, `onValueChange`, `maxLength`,
  `placeholder`, `onSubmit`, `autoFocus`); Enter calls `onSubmit` with the value. The plain and
  reference adapters map it (the reference adapter to hydrotik's `Input`). Nothing renders it yet.
  See docs/ui/contract-changes.md.
  To update: an adapter written for 1.4.0 or earlier keeps working (the built-in fallback draws a
  native label and text input); to draw your own, export `TextField` and set
  `"contract": "1.5.0"` in its conformance.json.
