### Added

- **Report to pxsig: a gate report for an issue, when the gate got an entry wrong.** A change
  flagged when nothing visible changed, or a visible change that passed, is worth an issue on
  hydrotik/pxsig, and pxsig now prepares it for one entry: the text in the shape of the new issue
  form "The gate got it wrong" (the pxsig version and engine build, the resolved gate with the color
  rule, the metrics, every reason, the changed regions' boxes, the environment class and the mode),
  one PNG with the baseline, the render and the diff side by side, cropped to the changed regions
  (or the full capture), and the link that opens the form with its fields filled. The story id is
  replaced with `entry-1` unless it is kept, and no path, user name or host name is ever in it. An
  image-free report lists each changed region's average colors instead of any image. pxsig opens
  no network connection for it and posts nothing: the person opens the link and posts.
  - The dashboard's inspector has **Report to pxsig** beside Re-check: it re-renders the entry on
    this machine first and says whether it still fails the gate (a dry re-render: the entry's
    render, its result and any review decision stay as they are), then previews exactly what is
    copied, with Full capture, Keep story ID and Image-free, and says the issue is public and
    cannot be fully removed. Copy text, Copy image (one PNG; Save image where the clipboard takes
    no images), Open issue and Cancel; nothing is copied until a copy button is pressed. A page
    without the dashboard link can prepare one too.
  - `pxsig report <id> [--full] [--keep-id] [--no-image]` writes it to the store's
    `reports/gate-report/<id>/` and prints the link. Without an id, `pxsig report` is the static
    dashboard, as before.
  - The MCP tool `pxsig_gate_report` prepares the same report and never posts; its description,
    the MCP instructions and docs/agents.md say an assistant asks the person before anything is
    posted publicly.
  - The server's `GET /__pxsig/gate-report` and `POST /__pxsig/gate-report/self-check`
    (docs/server.md).
  - docs/gate-issues.md: what a report holds and never holds, and how to post one.
- **Issue forms.** hydrotik/pxsig's issues start from a form: Bug, The gate got it wrong (with a
  required checkbox that the images contain nothing confidential), Feature and Documentation.
  Blank issues are off; security problems link to private vulnerability reporting.

### Fixed

- **Esc in a dialog over a dialog closes only the top one** in the plain adapter (and the example
  adapter in `examples/custom-ui`): a dialog's cancel no longer closes the dialogs around it.
