### Added

- **`pxsig dashboard parity`.** Sets each contract component your adapter pairs with a story of
  your design system beside that story, both rendered in one Chromium with pxsig's capture flags,
  in both themes, and lists what differs element by element: box model, font (and whether the face
  loaded), and the rendered alignment of a dot or icon on its label's capitals. Colour stays with
  the region rules. You supply your design system's built Storybook (`--storybook`, the folder
  holding `iframe.html`), a `parity` list on each component to compare in the adapter's
  `conformance.json` (story id, URL args, the component's props, expected differences with their
  reasons; `parity.storyRoot` and `parity.globals` at the top when your Storybook needs them), and
  the project's Vite to build the comparison page (or `--build`). Each missing piece is named in a
  setup error (exit 2); a difference not listed as expected, or a pair that did not render, exits 1.
  The parity page ships in the package (`dashboard/parity/`). docs/ui/build-adapter.md, "Source
  parity".

### Changed

- **The reference dashboard's components take their design system's reset and body type.** The
  prebuilt dashboard draws the design system's components as its own stories draw them: no
  browser padding or margins on their elements, border-box inside them, their buttons and fields
  in the surrounding font, and the body's line height (1.5) on the outermost of them, scoped to
  those components and nothing else of the page. Buttons, links and the copy button's text sit as
  in the design system; most screens move by a few pixels.

### Fixed

- **`pxsig dashboard check` no longer reports a control scrolled out of the window as overlapping.**
  A control whose centre is outside the window (scrolled under a sticky top bar) is not measured by
  the `overlap` rule, as it is not drawn there.
