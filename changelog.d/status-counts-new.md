### Fixed

- **`pxsig status` lists NEW entries.** After a first check the human `status` view printed an empty
  `States:` line, because its list of states had no `new` (`status --json` counted them). It now
  shows `+ new N` next to `changed`, and every human view (`status`, `list`, `check`, `doctor`)
  marks a NEW entry `+ new` instead of `? new`.
