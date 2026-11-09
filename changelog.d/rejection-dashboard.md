### Added

- **The dashboard shows a rejection's reason and hands it on.** A rejected entry's note reads
  "Rejected. Reason: …" with the re-check command, **Edit reason** (the reason's row again,
  prefilled; the inspector stays on the entry) and **Copy for an agent**: one paragraph with the
  reason, the goal, where the rejection packet is and the re-check command, in the words the
  packet, the CLI and MCP use. An entry checked again since its rejection, which still differs,
  shows "Rejected earlier: …" with **Dismiss reason** (`rejection-dismiss`). The review session's
  summary copies every rejected entry's paragraph, and the inspector's Files section links the
  entry's rejection packet. A reason the server did not keep (the store's `reports/` is not
  git-ignored) and a packet it could not write say so under the header. `/__pxsig/data` carries
  `settings.rejections.note.ask`, `paths.rejected` and each open rejection's `prompt`.

### Behaviour changes

- **Reject asks for an optional reason.** In the dashboard and the Storybook panel, Reject, R and
  the Accessibility section's Reject open a row under the header with one field, Reason (one line,
  at most 280 characters). Enter or the row's Reject rejects, with or without a reason; Esc or
  Cancel closes the row with no decision. Before, Reject and R rejected at once.
  To update: a script that clicks Reject (or presses R) then presses Enter, or clicks the row's
  Reject; or set `rejections.note.ask: false` in `pxsig.config.json` to reject at once, as before.

### Fixed

- **Typing in a field in the Storybook panel's inspector no longer triggers A or R.** The panel's
  keys skip text fields, as the dialog's already did, so typing a reason cannot approve or reject.
