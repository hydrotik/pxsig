### Fixed

- **Progress captions sit on whole pixels in the dashboard.** The design-system Progress caption row
  had a ratio line height, so a row with a label and a value was 15.125px and a list of them drifted
  off the pixel grid. It is now a 1rem line: 17px with a value, 16px with a label alone. Captions sit
  about a pixel lower.
