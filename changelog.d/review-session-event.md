### Fixed

- **A review session no longer goes back to the entry just approved.** The server's decision
  event arrives just before its answer; the inspector's refresh from that event could run after
  the move to the next entry and put the entry just approved back, with Approve disabled. The
  refresh now applies to the entry the inspector is on when it runs.
