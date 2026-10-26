### Behaviour changes

- **An approval cut short by a crash is `interrupted`, not a mismatch.** When a baseline was
  written but its log line was not (the process died in between), `pxsig approve verify` lists it
  as interrupted, with `pxsig approve undo <batch>` as the next step, instead of "written outside
  the trail". The exit code is still 1. Only a batch that started after the entry's last log line,
  and whose snapshot holds the bytes that line logged, counts.
- **A live lock holder is never taken over for a quiet heartbeat alone.** The store lock now
  carries a heartbeat (every 5 s); a holder whose process is alive keeps the lock even when it has
  gone quiet (a laptop that slept). After 10 minutes without a heartbeat, a person running a
  writing command at a terminal may take it over by typing `TAKE OVER`; agents and CI get exit 3.
  A lock whose process is gone is still taken over at once, as before.
- **`approve verify` no longer fails on a torn approval-log line.** It used to stop with a JSON
  error; it now leaves the line out and counts it (`torn`).

### Added

- **`log-torn`** (setup problem, `warn`): approval-log lines a crash cut short. `pxsig doctor
  --repair --only log-torn --apply` removes them after a typed `REMOVE <n> TORN LINES`, at a
  terminal only (exit 3 otherwise), never beside the server; complete lines keep their bytes.
- **Fencing.** Before each batch of store writes (the server's, `check --update`, `approve undo`,
  `verify --adopt`, `doctor --repair --apply`, `migrate --apply`) the writer checks the lock is
  still its own, and stops with "lock taken over by …: nothing more was written" if not.
- **The lock's heartbeat age** in every message that names the holder.

### Fixed

- **Records are written whole.** Every JSON record pxsig writes (reports, review, a11y baseline,
  manifests, plans, `server.json`, settings, the lock) goes to a temporary file, is flushed, then
  renamed over the old one, retried while Windows holds the file; a failed write (a full disk)
  leaves the old file. Log lines are appended in one write, and a torn tail is closed off first so
  it never swallows the next line. Baselines restored by `approve undo` are written the same way.
