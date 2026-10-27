### Fixed

- **The dashboard passes axe on every screen `pxsig dashboard check` renders** (62, both themes), with
  no visible change: each screen was compared pixel for pixel before and after.
  - The loading and load-error pages, the Storybook panel and the decision window it opens have a
    main region and a level-one heading (read by assistive technology, not drawn). The panel's
    story title is a level-two heading, below it.
  - A heatmap tile's text is read as "Card 2 stale of 2", so it is inside the tile's name (WCAG
    2.5.3, label in name); it was read as "Card2 stale of 2".
  - An alert's title is not a heading: the hydrotik reference adapter removes the heading role from
    its design system's title, as the default dashboard draws it as bold text. The UI contract says
    so; no props changed, so the contract version stays 1.1.0.
