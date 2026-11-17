### Fixed

- **The dashboard's own list controls show a 1px focus outline.** Scenario items, the inspector's
  region buttons and the Help page's rows drew a half-strength halo as their only focus indicator,
  2.7:1 against the surface in the dark theme and 2.3:1 in the light one, below the 3:1 of WCAG
  1.4.11. They now draw a 1px outline in the focus colour (7.0:1 dark, 6.7:1 light), which
  forced-colors mode also paints.
