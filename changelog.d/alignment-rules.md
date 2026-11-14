### Behaviour changes

- **`pxsig dashboard check` measures alignment from each screenshot.** Two rules, listed apart from
  the layout findings (`alignment` per screen in `report.json`, `summary.withAlignment`, an
  "Alignment" section in `summary.md`, the gallery): `aligned`, a dot or icon is centred on its
  label's capitals within 0.5px, read from the pixels the browser drew; and `whole-pixel`, a small
  component that draws an edge has its top and bottom on whole device pixels. Each finding names
  its cause (centred in an odd space, a fractional margin, padding or transform, an earlier sibling
  of fractional height, or a graphic centred on its line box). Like layout findings they are
  advisory; `--strict` exits 1 on any.
  To update: nothing to do unless you run `pxsig dashboard check --strict`; then fix each finding
  in the adapter or its design system (even spaces around centred components, a dot centred on
  the capitals), or mark an element `data-layout-allow="<reason>"`.

### Documentation

- **Source parity for adapters.** docs/ui/build-adapter.md, "Source parity": an adapter's
  `conformance.json` may pair a contract component with its design system's story (`parity`:
  story, args, the component's props, expected differences with reasons), and this repository
  compares the reference adapter's components with those stories, box model, font and rendered
  alignment, in its screens workflow.
