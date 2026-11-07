### Behaviour changes

- **The dashboard's top bar keeps Help visible at every width.** Help now comes before
  Diagnostics, so at a narrow width Diagnostics is the first link to move into the More menu.
  To update: nothing to do; the links' targets (`#help`, `#diagnostics`) are unchanged.

### Added

- **`width` on a dashboard screen** (`src/ui/features.ts`, `fixtures/screens.json`): the
  viewport's width for a narrow layout, 1280 when absent. The React view's side panel has a
  screen at 900 px wide in Compiler and in Renders.
