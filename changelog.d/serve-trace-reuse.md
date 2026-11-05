### Changed

- **The integrity pass after an approval traces nothing.** `pxsig serve` keeps the last pass's
  tracing of edited files; a pass started by a baseline or render change reuses it while the
  edited files, their modification times and the manifest's entries are the same. A source or
  manifest change, or a pass for any other reason, traces again. The ledger is the same.
