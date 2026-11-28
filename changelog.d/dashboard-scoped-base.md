### Changed

- **The dashboard takes hydrotik's own base styles for its components.** The reference adapter
  used a reset of its own for the design system's elements; it now calls the design system's scoped
  base stylesheet (`applyBaseStyles` on its `ds-` classes, without the heading rule, so the
  dashboard's titles keep their type). Inline code in an empty-state message is drawn at the body
  size (16px). The dashboard's own images and text areas inside a component no longer take the
  reset: story-card thumbnails are 1px taller, the inspector's signature images 2px larger, and the
  report text area's lines tighter.
