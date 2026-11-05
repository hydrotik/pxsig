### Behaviour changes

- **The inspector says when a decision is under way, and waits for the next entry to be drawn.**
  While the server answers, the button reads "Approving…", "Rejecting…" or "Accepting…" in a box
  that is `aria-busy` and shows the progress cursor; every decision button stays disabled, as
  before. After moving on, Reject and Approve, and the A and R keys, stay disabled until the next
  entry's images are drawn, so a second click or key press aimed at the last entry cannot decide
  the new one. Keys pressed meanwhile are dropped, not queued. Reject and Approve keep the width of
  their longer label, so they never move.
  To update: nothing to do. Scripts that drive the dashboard should wait for Approve to be enabled
  before clicking it (Playwright's `click` does) and not press A or R before the entry is drawn
  (the stage's `aria-busy` clears when it is).
