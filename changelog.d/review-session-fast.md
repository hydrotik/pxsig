### Fixed

- **Approving quickly no longer stalls a review session.** The next entry was picked from the data
  shown before the server's refresh arrived, so a quick approve could land back on an entry just
  approved, with Approve disabled. The session now skips the entries decided in it, A no longer
  approves an entry already approved, and a reload during a session reopens the session on its
  first undecided entry (the address carries `&session=`).
