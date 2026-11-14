### Changed

- **The dashboard sits on whole pixels.** Its own text that other parts stack under now has whole-pixel
  line heights (micro labels 14px, the lede 22px, the inspector's side panel 20px, its text
  changes 18px, the heatmap legend 16px), the top bar's approval badge is no taller than the
  badge, and the gate report's preview is a fixed 7rem tall (scaled to fit; the copy is still the
  full PNG). Small components on pxsig's own screens no longer land on half pixels, where the
  browser draws their borders and text apart.
- **pxsig's own screens hold source parity and alignment at zero.** The screens workflow fails on
  any alignment finding and any source-parity difference on pxsig's own screens. Where the cause
  is in the design system the reference adapter draws with (its StatusBadge, Select, DataGrid,
  CopyValue, Alert, CardHeader and Dialog), the adapter opts that component out of the alignment
  rules with the cause as its reason (`ds-exceptions.ts`), until the design system fixes it.
