### Behaviour changes

- **Elements marked `data-volatile` are masked, and masks are recorded and reviewed.** Content that
  varies from run to run (a time, "3 minutes ago", a commit hash, a build number) no longer fails a
  check when the element that shows it carries `data-volatile`: the inside of its box is painted
  over in every capture, in every project, with no configuration, while a change to the box's size
  or position still shows. The attribute's value is the reason (`data-volatile="relative time"`).
  Each render records the masks that applied (`<id>.masks.json`: selector, source, reason, masked
  pixels; no paths), and a baseline approved from it keeps them in its `.psig` header (`masks`).
  A mask added, removed or grown fails the entry with the reason `masks changed: …`, for a person
  to approve; nothing is approved automatically. Text under a mask is left out of the text record,
  and the a11y pass still runs on it. A project with no `data-volatile` element and no
  `capture.ignore` renders and checks exactly as before; masks from a story's `ignore` against a
  baseline approved before this version are not a change.
  To update: on the component that shows a varying value, set `data-volatile` (with a reason, if
  you like) on the element that shows it, e.g. `<time data-volatile="relative time">`. Adopting it
  (or `capture.ignore`) gives one "masks changed" entry per affected entry: review and approve them
  once, in the pull request that adds the attribute. Fixed story data (a fixed clock, fixed ids)
  stays the better answer where it is possible, since a fixed value is still compared.

### Added

- **`capture.ignore` and `capture.addIgnore` mask selectors in every story.** Set in
  `pxsig.config.json` or under the workspace file's `defaults`. `capture.ignore` replaces the list
  inherited from the workspace, as arrays do; `capture.addIgnore` adds to it. `pxsig config` lists
  each selector with the layer that set it. Both are off by default.
- **A mask over 25% of a capture is a warning.** `pxsig check` prints `[check] mask:` lines,
  summary.md gains a Masks line, and `check --sarif` adds a `pxsig/large-mask` warning per mask
  (`pxsig a11y --sarif` is unchanged). Warning only: it changes no verdict or exit code. Check rows
  carry `masks`, `masksLarge` and, on a change, `masksChanged` (docs/spec.md, section 7).
