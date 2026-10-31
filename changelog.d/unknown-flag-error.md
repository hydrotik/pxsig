### Breaking changes

- **An unknown flag is an error: `pxsig` exits 2 and runs nothing.** Until now a misspelled flag
  printed a warning and the command ran without it, so `pxsig check --ful` ran the quick check and
  `pxsig init --nmae web` wrote a config with the default name. The message is the same, with the
  nearest known flag (`pxsig: unknown flag --ful (did you mean --full?)`). `pxsig cat` is
  unchanged (the engine checks its flags).
  To update: a script or CI step that passes a misspelled or retired flag now fails; correct the
  flag the message names, or remove it.
