# UI contract changes

The UI contract (`packages/dashboard/src/ui/contract.ts`) has its own version, separate from
pxsig's. A UI adapter records the version it was written for in its `conformance.json`
(`"contract": "1.0.0"`; an adapter without the field counts as 1.0.0), and `pxsig dashboard gaps`,
`pxsig dashboard build` and `pxsig serve` compare it with this pxsig's:

| The adapter is written for | What happens |
| --- | --- |
| the same version | nothing to do |
| an older minor version (1.0 against 1.2) | it builds and works; `gaps` names what was added since, which renders its fallback or default until the adapter maps it |
| an older major version (1.x against 2.0) | `gaps` reports a problem and `build` refuses, with the migration notes of each major version below; `serve` keeps the prebuilt dashboard |
| a newer version | a note: parts newer than this pxsig's contract are unused |

**Minor:** a new optional component or prop with a fallback, a new token or icon with a default.
**Major:** a component or prop removed or changed in meaning, a new required component, a token or
icon without a default. A major version's section starts with its migration notes.

`pnpm ui:check` holds the version to `src/ui/contract-lock.json`: a change to the contract without
a version bump of the right size, or without a section here, fails. After the bump and the
section, `node scripts/ui.mjs lock` records the new contract.

## 1.0.0

The contract as it is today: 43 components (17 required), 38 tokens and 12 icons, with the 11 rules
in `contract.ts`. Every adapter written before the contract had a version is a 1.0.0 adapter.
