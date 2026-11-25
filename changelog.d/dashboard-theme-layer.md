### Behaviour changes

- **UI contract 1.11.0: pxsig's own looks are props, not dashboard classes.** The dashboard no
  longer restyles design-system components with its own classes; it asks for the look by prop, and
  the adapter draws it with its design system's variant: `Dialog` `layout="full"` (the full-screen
  inspector) and `flush` (no padding or gap: the inspector, the review summary, the gate report),
  `DialogTitle` `mono` (an id as the title: mono, one line, cut), `DialogDescription` `micro` (one
  line of micro caps), `Toolbar` `bar` (the inspector's toolbar band, items centred) and
  `CardDescription` `mono` (a scenario's change). The reference adapter maps them onto hydrotik's
  opt-in variants, and its top-bar count that asks for action onto hydrotik's subtle attention
  count; the plain adapter and `examples/custom-ui` draw them in their own stylesheet. pxsig's own
  dashboard looks the same as before
  ([contract changes](../docs/ui/contract-changes.md#1110)).
  To update: a third-party adapter written for 1.10.0 or earlier keeps building, but draws its
  design system's defaults for these (the inspector as a centred dialog, the titles in the
  dialog's own type); to keep pxsig's look, implement `Dialog` `layout` and `flush`, `DialogTitle`
  `mono`, `DialogDescription` `micro`, `Toolbar` `bar` and `CardDescription` `mono`, then set
  `"contract": "1.11.0"` in its `conformance.json`.

### Changed

- **`pnpm ui:check` holds pxsig's own looks to one declared theme layer.** The few rules that
  still change a design-system element, or that are exceptions on the dashboard's own markup (the
  story card's focus halo), live in `src/styles/theme-layer.css.ts`, each declared in
  `src/styles/theme-layer.json` with what it changes, why, its decision and the screens that show
  it. The check fails an export without its entry or an entry without its export, and an entry
  whose properties differ from the rule's. A focused story card is now visible in forced-colors
  mode.
