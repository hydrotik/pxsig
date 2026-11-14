### Fixed

- **The bundled dashboard's design-system components have their intended size.** The reference
  adapter loaded its design system's fonts but not its global box-sizing reset, so every one of
  its components was `content-box` and grew by its border and padding: a badge was 22px instead of
  20px, a keyboard key 22px instead of 20px, a slider thumb 20px instead of 16px, a stat card 35px
  wider, and data-grid cells and card edges off by a pixel or two. The adapter now applies that
  reset to the design system's own elements only (the classes its stylesheets define, prefixed
  through the new `classPrefixes` adapter build setting), and leaves the dashboard's own markup as
  it was.
