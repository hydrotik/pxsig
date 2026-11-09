### Added

- **Rejection packets: full-size crops of the changed regions and rejection.md, in the store's
  reports/, never committed.** An open rejection gets `<store>/reports/rejected/<id>/`
  (`<id>.a11y/` for accessibility): `rejection.md` (the reason in a fenced block, the goal, what
  changed, the changed regions with their crops, the text labels, the checks since and the re-check
  command), `rejection.json` (the same facts, for tools), `baseline.png`, `current.png`, `mask.png`
  and `crops/<n>.baseline.png`, `.current.png`, `.diff.png`, cut at full size from the engine's
  `diff`, padded, merged where they overlap and upscaled so a shift of a few pixels shows. Written
  after a reject, refreshed after each check of the entry (the server's and a full check), removed
  when the rejection closes; the server serves the files to its own origin only
  (`/p/<project>/reports/rejected/…`). Configured by `rejections` in `pxsig.config.json`
  (`note.ask`, `packet`, `crop.pad`, `crop.max`, `crop.scale`, `crop.annotate`, `structure`;
  docs/configuration.md#rejections). Every path in a packet is relative, and nothing in it
  approves.

### Behaviour changes

- **The store writes `reports/rejected/` while a rejection is open.** Only while git leaves the
  store's `reports/` out: otherwise no packet is written, the open rejection says why
  (`packetError`), and `pxsig doctor`'s `reports-not-ignored` finding now names rejection packets
  too.
  To update: nothing to do when the store's `reports/` is git-ignored (every store `pxsig init`
  made); otherwise add `reports/` to the store's `.gitignore`, or set `rejections.packet: false`.
