### Behaviour changes

- **Color changes in flat areas and cells fail the gate.** SSIM, the edge map and the detail
  channel read luminance only, and the cell rule needs a cell's mean RGB to move by more than
  `threshold` (24), so a small area changing hue at about the same lightness passed: a grey badge
  turning to a green wash (CIEDE2000 7.8), a status color on text, a lost row highlight. The new
  color rule runs after the other rules, on the entries they pass, and fails an entry when flat
  pixels (3×3 luminance range under 8 in both images) change by ΔE00 3 or more over 64 connected
  pixels, or when 3 or more grid cells change their mean color by ΔE00 5 or more. A render of
  another size than its baseline (a trimmed component one pixel wider) is compared over the region
  both cover, from the top-left, with the flat-area check alone. Its reasons read
  `color ΔE00 7.8 over 532 px (flat area) >= 3` and `color cells 4 >= 3 (ΔE00 >= 5)`, and each
  row carries its measurements as `color`. The flat-area check uses the baseline image in the
  `.psig`; it adds about 2 ms to a changed 900×600 entry (and up to 4 ms when every pixel drifts by
  one step), and well under 1 ms when the render's file is the baseline image. `gate.color`
  loosens it per project, workspace or story (`deltaE`, `minArea`, `cellDeltaE`, `minCells`;
  docs/configuration.md, "gate.color"); `false` turns it off. An entry checked with it off, or
  past its limits, is the new `gate-color-off` warning in `pxsig doctor` and the dashboard's
  Coverage view; `integrity.severity` can raise it to error but not lower it. A verdict from an
  engine older than the rule (a stale `PXSIG_BIN`) is refused, never recorded as a pass.
  To update: baselines whose colors drifted while the gate passed now show as changed, once.
  Review each in the dashboard and approve the ones that are intended. To loosen the rule for a
  project, set `gate.color` in its `pxsig.config.json` (for example
  `{ "deltaE": 5, "minArea": 128 }`); off or past its limits, `pxsig doctor` reports it
  (`gate-color-off`).
