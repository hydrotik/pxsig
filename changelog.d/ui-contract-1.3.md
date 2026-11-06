### Added

- **UI contract 1.3.0: `SidePanelLayout`, `SidePanelMain` and `SidePanel`**, three optional
  components taken as a set: records and the details of the one selected, side by side (the panel
  drops below on a narrow container). The panel is a `complementary` landmark named by its title,
  closed by its close button and by Escape; focus moves into it on open and back on close. The
  reference adapter maps them to hydrotik's `ContentLayout` and `SidePanel` (pushed in on the
  right, no resize handle or expand button). See docs/ui/contract-changes.md.
  To update: an adapter written for 1.2.0 or 1.1.0 keeps working (the built-in fallback draws all
  three); to draw your own, export all three and set `"contract": "1.3.0"` in its conformance.json.
