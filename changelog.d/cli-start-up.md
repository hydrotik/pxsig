### Fixed

- **`pxsig doctor` and every other command start as fast as in 0.7.6 again.** 0.7.7 read each
  baseline up to four times in `doctor` (for the image check, the unreviewed-baseline hash, the
  text count and the mask count); it is now read once. Every command also loaded the capture
  pipeline, the gate report and pngjs at start-up; they now load when a command uses them. Output
  is unchanged.
