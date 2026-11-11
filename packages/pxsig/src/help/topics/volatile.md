# Values that vary

A time, "3 minutes ago", a commit hash, a build number or a generated id differs from run to run:
each run shows a change that nobody made. Fixed data first; a mask when the value cannot be fixed.

- **Fixed data first.** A fixed value is still compared; a mask compares nothing inside it. Give
  the story the value instead of reading it at render time:
  - a fixed clock: the time as an arg (`now: new Date('2026-01-01T00:00:00Z')`), or the clock set
    before the story renders, and relative times formatted against it;
  - fixed ids: `id: 'order-1001'`, or a seeded generator, not `crypto.randomUUID()`;
  - a fixed hash: the commit or build as an arg the story sets (`commit: '0000000'`).
- **`data-volatile` on the component.** Its author marks the element that shows the value, once:
  `<time data-volatile="relative time">`. Every project that renders the component masks it, with
  no configuration. The inside of the box is painted over before the screenshot; its size and
  position are still compared. The value is the reason shown with the mask. Text under a mask
  stays out of the text record; the a11y pass still runs.
- **`capture.ignore` / `capture.addIgnore`.** Selectors masked in every story of a project
  (`pxsig.config.json`), or of every project (`defaults` in `pxsig.workspace.json`).
  `capture.ignore` replaces the inherited list; `capture.addIgnore` adds to it. `pxsig config`
  names the layer of each selector. A story's own `parameters.pxsig.ignore` masks that story only.
- **Recorded and reviewed.** Each render records its masks (selector, source, reason, the
  elements matched and their boxes); every approved baseline keeps them, none as an empty list. A
  mask added, removed, grown by any pixel, moved or matching another number of elements since the
  baseline fails the entry as `masks changed: …`, for a person to approve, whatever the pixels.
  `check --update` writes such a baseline only with `--allow-masks`. The dashboard's inspector
  lists the masks; when no pixel differs, it shows each mask's share in the baseline and in the
  render.
- **Limits.** All of an entry's masks together over 25% of the capture are a warning
  (`[check] mask:`, summary.md, `check --sarif`, the dashboard): most changes under them would
  pass. Over 50%, or a mask on the story root, the entry fails, and no approval passes it until the
  masks are smaller.
- **Adopting masks.** Marking a component, or a new `capture.ignore`, gives one "masks changed"
  entry per entry it applies to, approved once. A story's `ignore` against a baseline approved
  with 0.7.6 or earlier is not a change where that baseline's image shows it painted.

- **Assistants.** Never add a mask, ignore, `data-volatile` or raise a threshold to make an entry
  pass; flag the entry for a person instead (`pxsig help agents`).

See also: `pxsig help capture.ignore`, `pxsig help approvals`, docs/configuration.md (Masks).
