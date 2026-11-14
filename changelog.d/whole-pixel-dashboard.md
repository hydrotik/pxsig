### Changed

- **The dashboard sits on whole pixels.** Its own text that other parts stack under now has whole-pixel
  line heights (micro labels 14px, the lede 22px, the inspector's side panel 20px, its text
  changes 18px, the heatmap legends 16px), the top bar's approval badge is no taller than the
  badge, and the gate report's preview is a fixed 7rem tall (scaled to fit; the copy is still the
  full PNG). The plain adapter's badges are 18px on a 16px line, its status lines and table cells
  on 20px lines, and its dialogs sit 3rem from the top rather than centred. Small components no
  longer land on half pixels, where the browser draws their borders and text apart.
- **pxsig's own screens hold source parity and alignment at zero.** The screens workflow fails on
  any alignment finding and any source-parity difference on pxsig's own screens. Where the cause
  is in the design system the reference adapter draws with (its StatusBadge, Select, DataGrid,
  CopyValue, Alert, CardHeader and Dialog), the adapter opts that component out of the alignment
  rules with the cause as its reason (`ds-exceptions.ts`), until the design system fixes it.
