### Added

- **pxsig_rejected and pxsig rejected: open rejections with reasons and crops.** The MCP tool
  `pxsig_rejected` (read-only, no server needed) and the command `pxsig rejected [ids…]
  [--kind visual|a11y] [--closed] [--prompt]` list the open rejections: each reason, newest first,
  with who gave it (an assistant's is labelled as one), the checks since, the metrics, the changed
  regions with their full-size crops, the packet folder, one paragraph for the fix (`prompt`) and
  the re-check command, which the answer repeats for every entry shown. Crops are file references
  (store-relative; relative to the current folder in the CLI); `images: "crops"` returns them
  inline, `full` also the baseline, current and mask images, at most 18 per call. `closed: true`
  (`--closed`) reads the last closed rejections from the log, text only. `pxsig rejected --prompt`
  prints one paragraph per open rejection, for a session-start hook (docs/agents.md; `pxsig setup`
  installs none). `pxsig_status` gains `openRejections`; `pxsig_list` gives a rejected entry's
  `note`, and `rejectedBefore: true` on a changed entry whose rejection is still open;
  `pxsig_entry` gains `rejection` and `images: ["crops"]`; `pxsig_check` gives each checked entry
  that had an open rejection as `closed: passes` or `open: still differs`; `pxsig_review` takes a
  `note` with `reject` and `a11y-reject`, kept as an assistant's; `pxsig entry` shows a Rejection
  block. The MCP server's instructions say to read `pxsig_rejected` before a visual fix.

### Behaviour changes

- **The instruction `pxsig setup` prints gains one line:** "Before fixing a rejected pxsig entry,
  read its reason and images (pxsig_rejected, or `pxsig rejected`); after the fix, re-check those
  ids." `pxsig setup` never changes an instruction file that exists.
  To update: add the line to the assistant's instruction file (`pxsig setup --print` prints the
  whole instruction).
