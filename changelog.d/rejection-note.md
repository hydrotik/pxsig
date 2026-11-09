### Added

- **A rejection keeps its reason.** `POST /__pxsig/reject` and `/a11y-reject` take an optional
  `note`: one line of plain text, at most 280 characters (control characters and line breaks
  become spaces). The reason is stored with the decision and opens the entry's **open rejection**
  (`<store>/reports/rejections.json`), which outlives the decision: a re-check still clears the
  decision and the entry waits for a person again, but the rejection, its reasons and the checks
  since stay until the entry passes (or has no new accessibility violations), a person approves
  it or accepts its violations, the rejection is undone, a person dismisses the reason
  (`POST /__pxsig/rejection-dismiss {id, kind}`, a person's only), or the entry leaves the
  manifest. `<store>/reports/rejections.ndjson` logs every event, so a reason outlives its
  rejection. `/__pxsig/data` carries the open rejections (`rejections`) and the reasons. A reason
  sent through the MCP's token is kept as an assistant's (`via: mcp`) and never replaces a
  person's.
- **Every decision carries an opaque reference.** Approve, reject, accept, unaccept, prune, undo
  and dismiss get a `ref` (`d_` and 16 random characters, with no time, host, user or entry in
  it), kept in the decision files and in the `approvals.ndjson` and `a11y-decisions.ndjson` lines.
  A rejection's reason stays in the store's git-ignored `reports/` only, never in a committed file.
  Nothing sends the reference anywhere.

### Behaviour changes

- **`unreview` and `a11y-unreview` also close the entry's open rejection, and an assistant cannot
  clear a person's rejection.** The MCP's token may still reject and clear a rejection it made;
  clearing a rejection a person made, or gave a reason for, is refused (403, "clearing a person's
  rejection needs a person: …"), as clearing a person's approval or accept already was.
  To update: an assistant that cleared rejections asks the person, who clears it in the dashboard.
- **`/__pxsig/status` and the static report carry no reasons.** `/status` is read by Storybook's
  origins, so its `review` entries leave `note` out; `pxsig report` leaves out every `note` and the
  open rejections, since a static report is made to be shared.
  To update: read the reasons from `/__pxsig/data` (same-origin).
- **The approval and accessibility logs gain a `ref` key on each new line.** Lines already written
  are unchanged, and `pxsig approve verify`, `log` and `undo` read both.
  To update: nothing to do; a tool that matched a log line's keys exactly allows `ref`.
- **The store writes `reports/rejections.json` and `reports/rejections.ndjson`** once an entry is
  rejected.
  To update: nothing to do when the store's `reports/` is git-ignored (every store `pxsig init`
  made); otherwise add `reports/` to the store's `.gitignore`, so notes are kept (while it is not
  ignored, a rejection opens with no note).
