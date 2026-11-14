### Breaking changes

- **`approve plan` treats a masks change as its own class.** An entry whose masks changed is
  planned as `kind: "masks"` (its pixels' kind kept as `change`), and is blocked unless named in
  `--allow-masks id,id`, whatever its pixels: it is never passed as colour only. A shape change
  under it also needs `--allow-shape`. Masks no approval passes (over 50% of the capture, or on the
  story root) are always blocked, and the server refuses to approve them. The dashboard's Approve
  story leaves such entries out, to be approved on their own.
  To update: review each masks change, then re-plan with `--allow-masks <ids>`.

### Behaviour changes

- **Approvals of a masks change say so.** Every approval of an entry whose masks changed (the
  dashboard, `approve apply`, `check --update`) is logged with `kind: "masks"` and `masks`: what
  changed, `{ added, removed, grew, moved, count }`, selectors only.
  To update: nothing to do; tools that read `approvals.ndjson` can count masks approvals by `kind`.
