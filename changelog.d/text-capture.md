### Added

- **Text capture records the text each render draws (on by default).** Right after the screenshot,
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

- **Text capture is on by default.** Every render writes its text record beside its PNG
  (`renders/latest/<id>.boxes.json`, git-ignored with the rest of `renders/`), and every baseline
  approved after upgrading carries it as a `boxes` section: the strings the baseline image already
  shows, committed with it, never a form field's value. Baselines approved before stay as they are
  ("no text record" until next approved). A story's render takes about 2 ms more (a
  dashboard-sized screen about 9 ms; about 1% of the render or less), and its baseline about
  0.5 KB more (a dashboard-sized screen about 2.4 KB).
  To update: nothing to do to keep checking as before: gates, verdicts and exit codes are
  unchanged. To keep text out of new baselines, set `"text": false` in `pxsig.config.json` (or
  `defaults.text` in `pxsig.workspace.json`); `--no-text` or `PXSIG_TEXT=off` turns it off for one
  run, `parameters.pxsig.text: false` for one story's entries.

- **`pxsig doctor` has a Text row** (and `text` in `--json`): whether text capture is on, and how
  many of the manifest's baselines carry a text record.
  To update: nothing to do; a script that reads `pxsig doctor --json` gets one more key.
