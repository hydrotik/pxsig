### Fixed

- **The dashboard opens a report whose summary is incomplete.** A `check.json` with an empty or
  partial `summary` (written by hand, by an older run, or cut short) stopped the page with
  "Cannot read properties of undefined (reading 'join')". The dashboard now reads a missing count
  as 0, missing modes as none, and a missing timing as a dash, in every section.
