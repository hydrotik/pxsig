### Added

- **Text capture: `"text": true` records the text each render draws.** Right after the screenshot,
  pxsig reads every DOM Text node the render draws (its string, a box per line in the screenshot's
  frame, its font facts, a path and a unique key) and the painted element boxes around it
  (backgrounds, borders, shadows, `svg`, `img`), and writes them beside the PNG as
  `renders/latest/<id>.boxes.json`, the render's text record. A baseline approved from that render
  (in the dashboard, `pxsig approve`, or `check --update`) stores the record as its `boxes`
  section, deflated, and `pxsig cat` prints its strings, so `git diff` of a baseline shows a copy
  change. It is the groundwork for labelling a change as copy, reflow, moved or restyled text, and
  labels nothing yet. Reading changes no pixel: renders, gates, verdicts, exit codes and check.json
  rows are the same with it on or off. Left out: text outside the frame or clipped by an `overflow`
  ancestor, invisible text, text under an open dialog it is not part of, text under the entry's
  `ignore` masks and the new `text.ignore` selectors, iframes, and every form field (a field's value
  is never read). Off for one run with `--no-text` or `PXSIG_TEXT=off`, for one story with
  `parameters.pxsig.text: false`. In pxsig's own repository, the dashboard's screens record theirs.

### Behaviour changes

- **`pxsig doctor` has a Text row** (and `text` in `--json`): whether text capture is on, and how
  many of the manifest's baselines carry a text record.
  To update: nothing to do; a script that reads `pxsig doctor --json` gets one more key.
