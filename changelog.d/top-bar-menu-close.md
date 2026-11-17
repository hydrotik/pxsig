### Fixed

- **An open More menu closes when the window widens and every section fits.** On the reference
  adapter (the bundled dashboard) the menu stayed open with its trigger hidden: an empty box sat at
  the top left of the window, and the menu came back open with its sections when the window
  narrowed again. The design-system pin moves to hydrotik's fix, which also closes a section menu
  that moves into More while open. The plain adapter and `examples/custom-ui` already closed it.
  The top-bar flow test now checks this on every adapter.
