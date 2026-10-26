# The component catalog

`pxsig/ui/catalog/hydrotik.json` (in a clone: `docs/ui/catalog/hydrotik.catalog.json`) describes
every component family of the design system the reference adapter is built on: what each one is,
when to use it, and the equivalent component in eleven other design systems (Carbon, Material,
Ant, Fluent, Atlassian, Polaris, Spectrum, Primer, Bootstrap, Chakra, shadcn), with a doc link and
how closely it matches.

To map another design system onto the dashboard:

1. Filter `components` for `usedBy: ["pxsig"]`: the 23 families the dashboard renders, with the
   components it uses in `pxsigParts`.
2. Read each family's `aliases` for your system, or its `summary`, `use` and `tags`.
3. Check `collisions`: names such as Dropdown, Badge and Table mean different components in
   different systems.
4. Check `systems`: Polaris is archived (Polaris React is deprecated).
5. Build the adapter against the UI contract.

See `node_modules/pxsig/docs/ui/catalog/README.md` and `docs/ui/build-adapter.md`.
