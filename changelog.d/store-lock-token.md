### Behaviour changes

- **Taking over a stale store lock prints one line on stderr**: "the store lock was stale (…): taken
  over", naming the pid that held it. It used to happen silently. Standard output is unchanged.
  To update: nothing to do; a script that treats any stderr output as a failure should match on the
  exit code instead.

### Fixed

- **A store lock left by a killed process is taken over on Windows too.** A pxsig process stopped
  outright (Task Manager, a closed terminal, `kill -9`) leaves its store lock behind. The next
  command judged it by its process id, and Windows gives a freed id to another process within
  seconds, so `approve undo`, a full check or the server could report the store as held by a
  process that had nothing to do with pxsig. A lock now records a random token, and its holder keeps
  `<store>/reports/.lock-<token>` open for as long as it holds the lock; a lock counts as held only
  while that file is held open, on every OS, with no other program started and no port opened. The
  next command takes a stale lock over and prints "the store lock was stale (…): taken over", naming
  the pid. Locks written by an older pxsig are judged as before.
- **Two commands taking over the same stale store lock at once could both hold the store.** Each
  removed the stale lock and created its own, and the second could remove the first one's new lock.
  A stale lock is now replaced through a claim only one taker can make; the others report the store
  as held.
