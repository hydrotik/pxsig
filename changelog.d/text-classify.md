### Added

- **`pxsig check` labels the text change in each row (`textDiff`).** When a render has a text
  record and its baseline has one too, the engine compares the two and the row in check.json gains
  `textDiff`: the entry's kind (`copy`, `copy-reflow`, `moved`, `restyled`, or `pixel` when changed
  pixels lie outside every text change), the changes (a string's old and new text, a run's move,
  the font facts that differ, a run added or removed, and which copy change pushed a moved run),
  their counts, and the changed pixels inside and outside the changed text. A painted box (a card,
  a tile, a pill) or the capture itself grown or moved by a copy change counts as part of the
  reflow, and a change that drew no changed pixel (text under a dialog) gets no label. Text is
  compared only when the render and its baseline were made in the same environment (the
  environment id the pixel check reports): otherwise `textDiff` is `{ "v": 1, "state":
  "env-differs" }`, since text boxes differ across operating systems and fonts. A baseline with no
  text record reads `no-baseline`; a record that does not read, `error`. A passing entry whose text
  changed is labelled too and still passes. Labels only: the gate, its reasons, `pass`, every
  verdict and exit code are the same with text capture on or off. The dashboard, `pxsig entry`,
  `pxsig list` and MCP do not show the labels yet.
- **`text.movePx`, `text.edgePx` and `text.noisePx`.** The tolerances the labels use: how far a
  box may move and still be in place (0.5 px), how far around a text run a changed pixel still
  belongs to it (2 px), and how many changed pixels outside text a text label still allows (0). A
  bad value is a warning and its default. Labels only.
- **The engine's `check` takes `--env`** (an env plan, as `baseline --env` takes; the server's
  `check` takes it as `env`), naming each render's environment.

### Behaviour changes

- **check.json rows carry `textDiff`** when the render has a text record (text capture is on by
  default).
  To update: nothing to do; a script that reads check.json rows gets one more key, and nothing
  else in the row changes.
- **The check cache starts afresh.** Its key now covers each render's text record, environment and
  the text tolerances, so the first check after upgrading compares every entry again. A passing
  entry whose text changed also gets a full-resolution pixel diff for its label.
  To update: nothing to do.
