### Added

- **`pxsig dashboard check` measures each screen's layout.** After a screen renders it records
  layout findings beside axe: the page scrolling sideways at 1280 or 900 px wide, content cut off
  by `overflow: hidden` (truncated text passes when a `title` or `aria-label` holds it), controls
  in one toolbar line that differ in height or bottom edge, text or controls within 2px of a drawn
  frame, and controls drawn over each other. They are in `report.json` (`layout`, and
  `summary.withLayout`), `summary.md` and the gallery. Advisory; `--strict` fails on them as it
  does on axe. An element opts out with `data-layout-allow="<reason>"`.
