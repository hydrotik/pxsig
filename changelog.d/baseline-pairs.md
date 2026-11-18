### Behaviour changes

- **`pxsig doctor` reports baselines whose record and image come from different renders.** A
  `.psig` holds a record (what the gate reads) and an image (what the inspector shows). `pxsig
  migrate` packed each old record with the old store's image without checking that they were one
  render, so a check could fail an entry while the inspector showed nothing, or pass one whose
  image shows something else. The new setup error `baseline-pair-mismatch` names every such entry
  (`ids`, and `pairs` with each record's and image's sha256; `pxsig doctor` prints the table) and
  the fix. It is an error, so `pxsig doctor` exits 2 while any remain; `integrity.severity` cannot
  lower it. The dashboard's coverage banner shows it. The check reads each image once through the
  engine's new `pxsig pairs` (0.15 s for a 2,754-baseline store).
  To update: run `pxsig doctor`; for the entries it lists, run `pxsig approve repair-records` for
  the eligible ones and review the rest.
- **`pxsig migrate` packs a record with its image only when they are one render.** On a mismatch
  the record is packed alone and its id is listed under "Image left out" (`pairMismatch` in
  `--json`, and in the summary); an engine that cannot check refuses the migration.
  To update: nothing to do for a store already migrated (`pxsig doctor` reports its pairs); a new
  migration lists the records it packed without their image.

### Added

- **`pxsig approve repair-records`, and Repair baseline records in the dashboard.** For a baseline
  whose record and image differ, writes the record again from the image already in the baseline,
  only when its latest render is that image pixel for pixel, the render passes the current record
  under every rule except the colour rule, and only `pxsig migrate` ever approved it. It lists the
  eligible entries with why each qualifies and the others with every condition each fails; `--yes`
  (a person at a terminal, from a list printed in the last 24 hours) or the dashboard's confirm
  (the dashboard link; each entry's image is shown first) writes them. It approves no change: the
  image, masks, thresholds and config stay as they are, the entry stays unreviewed, and the safe
  repairs never run it. Each write is snapshotted (`pxsig approve undo <batch>`) and logged with
  the new kind `record-repair`, with the file's and the record's sha256 before and after;
  `pxsig approve verify` fails such a line whose record does not match its image
  ([docs/cli.md](../docs/cli.md#record-repairs)). The engine gains `pxsig pairs` and
  `pxsig rerecord`.
