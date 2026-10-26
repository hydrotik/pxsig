# Component catalog

`hydrotik.catalog.json` describes every component family of the design system the reference
adapter is built on (`dashboard/src/ui/adapters/hydrotik/`). Use it to map another design system
onto what the dashboard needs before writing an adapter ([build-adapter.md](../build-adapter.md)).

| File | Contents |
| --- | --- |
| `hydrotik.catalog.json` | One record per component family, the other design systems, and the names that collide between them |
| `hydrotik.catalog.schema.json` | The JSON Schema of the catalog |
| `hydrotik.catalog.source.json` | The hydrotik commit the copy was taken from |

In the npm package the files are exported as `pxsig/ui/catalog/hydrotik.json`,
`pxsig/ui/catalog/hydrotik.schema.json` and `pxsig/ui/catalog/hydrotik.source.json`.
`pxsig help catalog` prints a summary.

## A component record

| Field | Meaning |
| --- | --- |
| `name`, `parts`, `import` | The component, the other components of its family, and where it is imported from |
| `summary` | What it is, in one sentence |
| `use` | When to use it, and what to use instead |
| `tags` | Descriptive terms other teams use for the same thing |
| `aliases` | Per other design system: the equivalent component's `name`, its doc page `url`, what it `does`, how well it matches (`equivalent`, `close`, `partial`), and a `note` on the difference when it is not equivalent |
| `usedBy`, `pxsigParts` | `["pxsig"]` when the reference adapter uses the family, and which of its components it uses |
| `deprecated`, `internal` | Present when the family is deprecated, or not meant for apps |

## Mapping your design system

1. **Start with the families the dashboard uses.** Filter `components` for `usedBy: ["pxsig"]`;
   23 families qualify. `pxsigParts` lists the components the reference adapter actually
   renders. These are the only families an adapter has to cover.
2. **Find your equivalent.** If your design system is one of the eleven in `systems`, read its
   entry under `aliases`. Otherwise read `summary`, `use` and `tags`, and search your own
   documentation for those terms. Where the match is `close` or `partial`, the `note` says what
   differs and what usually covers the gap.
3. **Check the collisions.** `collisions` lists names that mean different components in different
   systems. "Dropdown" is a select in Carbon and Fluent but an action menu in Ant and Bootstrap;
   "Badge", "Notification", "Label" and "Table" are others. A component of yours with one of these
   names may map to a different family than its name suggests: compare what it `does`.
4. **Check the status.** `systems` gives each system's version and `status`. Polaris is
   `archived`: Polaris React is deprecated, its repository archived and its docs moved to
   shopify.dev. Its aliases still map, but a new UI should not adopt it.
5. **Implement the contract.** The catalog says which of your components to use; the UI contract
   says what the dashboard needs from each one. Continue with [build-adapter.md](../build-adapter.md),
   which works through every contract component and its acceptance criteria.

## Where the copy comes from

The catalog is generated in hydrotik (`docs/llm/catalog.json`, by `hy-ai catalog`) and copied here
with `node scripts/sync-catalog.mjs --from <hydrotik checkout>`. The copy leaves out each record's
`context` (the path of its context file inside hydrotik, which does not ship with pxsig). The
script refuses a checkout with uncommitted catalog changes or a commit that is not pushed, and
checks the catalog against its schema.

A pxsig test compares the reference adapter's design-system imports with the catalog's
`pxsigParts`. When they differ, update hydrotik's record (`hy-ai catalog --pxsig-adapter
<pxsig>/packages/dashboard/src/ui/adapters/hydrotik/index.tsx`), then sync the copy again.
