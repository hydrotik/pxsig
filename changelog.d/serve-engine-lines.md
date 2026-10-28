### Fixed

- **`pxsig serve` clears a project's load error once its manifest loads again.** The project list
  (`GET /__pxsig/projects`, the dashboard) kept showing the old error after a later reload worked.
- **`pxsig serve` skips an engine output line that is not a JSON object.** A `null` line, a number
  or text that is not JSON used to stop the server (and, in the affected-files lookup, leave the
  request waiting forever); such a line is now ignored and the next answer is read as usual.
