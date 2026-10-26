### Added

- **A component catalog for mapping another design system onto the dashboard.**
  `docs/ui/catalog/hydrotik.catalog.json`, exported as `pxsig/ui/catalog/hydrotik.json`, describes
  every component family of the reference adapter's design system:
  - what it is and when to use it;
  - which ones the dashboard uses (`usedBy`, `pxsigParts`);
  - the equivalent component in eleven other design systems, with a doc link and how closely it
    matches;
  - the names that mean different components in different systems (`collisions`).

  The `systems` section marks Polaris as archived. The schema, the commit the copy came from and
  a README with the mapping steps sit beside it. `pxsig help catalog` summarises it.
  `scripts/sync-catalog.mjs --from <hydrotik checkout>` refreshes the copy, and a test fails when
  the reference adapter's imports and the catalog's `pxsigParts` disagree. No behaviour change.
