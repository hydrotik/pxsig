### Behaviour changes

- **The report's modes moved in the dashboard's top bar.** The `dark · light` badge sits at the end
  of the bar beside the connection badge (Live, Offline or Static report) instead of beside the
  title. It still hides on a narrow window. Layout only: nothing else in the bar moves.

### Added

- **`label` in `pxsig.config.json`**: the dashboard title after "pxsig ·", for example
  `"label": "Hydrotik"`. 1 to 60 characters; without it the title is the project name, as before.
  `pxsig init --label <text>` writes it, and a person at a terminal setting up a new config is asked
  once (Enter keeps the name; CI, an assistant or piped output is never asked). `pxsig config` shows
  the title, and the project switcher lists projects by their label.
- **The versions that drew the page.** Hovering "pxsig" in the top bar shows the pxsig, engine and
  UI contract versions; the Help section ends with the same line as text. The dashboard data gains
  `label` and `versions` (additive).
- **UI contract 1.1.0: an optional `Tooltip`** (`content`, `children`). An adapter without it gets
  the element's native `title` (docs/ui/contract-changes.md). The hydrotik reference adapter maps it
  to its design system's Tooltip.
