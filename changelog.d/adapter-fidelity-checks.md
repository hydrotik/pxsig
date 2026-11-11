### Behaviour changes

- **`pxsig dashboard check` fails an adapter that breaks a region rule.** Every screen is now
  measured against the region rules of the UI contract (docs/ui/build-adapter.md, "Region rules"),
  and each finding names the element that breaks one: `one-line` (the top bar, a toolbar or a row
  of actions takes more than one line), `size` (controls on one line differ in height, or a
  table's actions are taller than the page's small size), `casing` (a header, heading, link,
  button, badge or label drawn in another case than pxsig's copy) and `tone` (a stat card, badge
  or status badge showing its tone as a border, edge, wash or shadow). Unlike axe and layout
  findings, any one exits 1 without `--strict`. They are in `report.json` (`fidelity` per screen,
  `summary.withFidelity`), `summary.md` ("Region rules"), the gallery and the command's output.
  To find the regions in any adapter, the dashboard adds `pxsig-ui-TopNav`, `pxsig-ui-StatGroup`,
  `pxsig-ui-Badge` and `pxsig-ui-StatusBadge` to those components' `className`. The plain example
  adapter's top bar has no overflow menu, so it still wraps on three screens (the project picker
  at 1280 px, two React screens at 900 px) and fails there.
  To update: run `pxsig dashboard check` on your adapter's build. For each finding, change the
  adapter, not the dashboard: keep the top bar on one line (an overflow menu for the links), draw
  a toolbar's controls and a table's actions at your small size, drop `text-transform` and any
  re-casing from headers, headings, links, buttons, badges and labels, and show a tone as the
  colour of a stat card's value, a badge's text or a status badge's glyph, with neutral borders
  and washes. Keep `className` on each component's root element. An element that breaks a rule
  on purpose takes `data-layout-allow="<reason>"`.
