### Behaviour changes

- **pxsig's dashboard: stat cards show their tone as an edge again, as well as the value.** In the
  bundled dashboard (the hydrotik reference adapter), a stat card in `success`, `warning` or
  `danger` has its design system's 2px accent edge on its start side again, as in 0.7.6, and its
  value keeps the tone's colour, as in 0.7.7. `info` and untoned cards have no edge, as before. UI
  contract 1.8.0 allows it: region rule R4 lets a `StatGroup` item draw a start edge in its tone's
  own colour, its value in the same colour, the label, background and other borders neutral. `pxsig
  dashboard check` passes such an edge and still fails one in another tone's colour, one beside a
  neutral value, or a wash ([build-adapter.md, "Region rules"](../docs/ui/build-adapter.md#region-rules)).
  To update: nothing required. An adapter that colours only a stat card's value still passes; an
  edge in the item's tone is now allowed.
