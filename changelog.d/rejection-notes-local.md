### Behaviour changes

- **A rejection's note is kept only when the store's `reports/` is git-ignored.** The open
  rejection (`reports/rejections.json`, `rejections.ndjson`) is held to the same check as a
  decision's reason: while git would pick up `reports/`, a reject or a11y-reject with a `note`
  still opens the rejection, with `note: null`, and the server's answer says the note was not kept
  (`notice`: `Note not kept: <store>/reports/ is not git-ignored. pxsig doctor shows the fix.`,
  and `noteKept: false` on the decision), with the same line in the server's log. pxsig asks
  `git check-ignore` only for a reject with a note, never blocking; outside a repository the note
  is kept.
  To update: nothing to do when the store's reports/ is git-ignored (every store pxsig init made);
  otherwise add `reports/` to the store's .gitignore.
