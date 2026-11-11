### Behaviour changes

- **The single-entry `compare` weighs masks as `check` does.** `pxsig compare` and the `compare`
  method of the long-lived engine (`pxsig serve`'s stdio protocol) read the render's masks record
  beside the PNG and compare it with the baseline's header `masks`: a mask added, removed or grown
  fails the comparison with the reason `masks changed: …` and the same `masks`, `masksLarge`,
  `masksChanged` and `masksBaseline` fields as a check row, so a single comparison and `check`
  never disagree. `pxsig compare` exits 1 on a masks change, as on a pixel change. A render
  without a masks record compares as before.
  To update: nothing to do; a script that calls `pxsig compare` on a render with masks now sees
  the masks change that `pxsig check` already reports.

### Added

- **Check rows carry `masksBaseline`** beside `masksChanged`: the baseline's masks with their
  areas (`[]` when it recorded none), for a reviewer to compare (docs/spec.md, Masks).
