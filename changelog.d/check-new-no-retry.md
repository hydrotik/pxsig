### Behaviour changes

- **`check` no longer retries an entry with no baseline yet.** A NEW entry has nothing to compare
  with, so a fresh render could not pass; it was re-rendered `--retries` times and the retry lines
  counted it. A first `check --full` on a new project is faster (6.6 s → 2.5 s on 12 entries).
  To update: nothing to do; the entry is still NEW and fails the check until it is approved.
