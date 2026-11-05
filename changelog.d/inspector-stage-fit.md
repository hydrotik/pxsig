### Fixed

- **The inspector fits each entry to its own image.** Moving to the next or previous entry could
  leave the stage fitted for the previous entry's image size until Fit was pressed: the fit ran
  before the new entry's images had arrived. The stage now waits for them, and stays busy until
  they are drawn.
