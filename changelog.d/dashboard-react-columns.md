### Fixed

- **The React tables give the entry and the file the room.** Every column of Diagnostics › React's
  Renders per Entry and React Compiler tables had the same width (226 and 194 CSS px at 1440), so
  a design system's entry ids (`components-chart--area-chart-stacked@light`) and file paths were
  cut off while the number columns stood half empty. The counts, outcomes, rule, line and top
  component now get a width that fits them, and Renders' Entry column (772 px at 1440) and the
  Compiler's File column (588 px) take the rest, as the Overview's tables do. The File column
  keeps at least about 14 characters (the table scrolls when the room is narrower, as with the
  side panel open at 900 px), cuts a long path at its end, and shows the full path on hover and
  in the side panel.
