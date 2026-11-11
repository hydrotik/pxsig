### Documentation

- **The region rules an adapter keeps.** The UI contract (`contract.ts`) and
  `docs/ui/build-adapter.md` now state, region by region, what an adapter may not change: the top
  bar on one line at every width, and a toolbar's controls and a row of actions on one line at
  1280 CSS px (R1); one control height per row, with a table's actions at the small size (R2);
  headers, headings and labels in the case of pxsig's copy, never re-cased by the adapter, stat
  labels alone in capitals (R3); and one way to show a tone, as the plain adapter draws it: the
  value of a stat card, the text of a badge and the glyph of a status badge take the tone's
  colour, while borders, edges and washes stay neutral (R4). "Region rules" in build-adapter.md is
  the layout map; "What a faithful adapter keeps" and the `TopNav`, `Button`, `CardTitle`,
  `StatGroup`, `DataTable`, `StatusBadge`, `Badge` and `Toolbar` sections say the same. No
  component or prop changes, so the contract version stays 1.5.0.
