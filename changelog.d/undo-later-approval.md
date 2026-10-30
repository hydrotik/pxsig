### Fixed

- **`pxsig approve undo` and the dashboard's undo no longer revert a later approval.** Undoing a
  batch restored its old baseline even when the entry had been approved again in a later batch,
  so the later approval was reverted without a word (the undo was logged, the later approval's
  baseline was gone). Such an entry is now refused with "approved again in batch <batch> after
  this one: undo that batch first", and nothing is written for it. A baseline written outside the
  approval trail is restored as before (`approve verify` reports those).
