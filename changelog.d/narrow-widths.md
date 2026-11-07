### Behaviour changes

- **The dashboard's top bar keeps Help visible at every width.** At a narrow width the other
  section links (Diagnostics first) move into the More menu and Help stays in the bar, with an
  adapter on UI contract 1.4.0 (the reference adapter is).
  To update: nothing to do; an adapter written for 1.3.0 or earlier keeps moving Help into its menu
  until it maps `keep` and sets `"contract": "1.4.0"` in its conformance.json.

### Added

- **`width` on a dashboard screen** (`src/ui/features.ts`, `fixtures/screens.json`): the
  viewport's width for a narrow layout, 1280 when absent. The React view's side panel has a
  screen at 900 px wide in Compiler and in Renders.
