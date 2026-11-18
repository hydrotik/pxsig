### Fixed

- **The dashboard's own list controls show a 1px focus outline.** Scenario items and the
  inspector's region buttons drew a half-strength halo as their only focus indicator, 2.7:1
  against the surface in the dark theme and 2.3:1 in the light one, below the 3:1 of WCAG 1.4.11.
  They now draw a 1px outline in the focus colour, which forced-colors mode also paints. The
  reference dashboard's focus colour is the design system's own (`focusColor`, between the border
  colour and the focus ring), as on its components: 3.8:1 dark and 3.3:1 light on a card.
- **The inspector's image stage and its swipe handle show their keyboard focus over the images.**
  The stage's focus ring was an inset shadow the images covered, so focusing it showed nothing, and
  the swipe handle had the browser's default ring. Both now draw two 1px lines above the images, on
  keyboard focus only: the focus colour, and the page background inside it.
