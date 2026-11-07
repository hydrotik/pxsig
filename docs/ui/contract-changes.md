# UI contract changes

The UI contract (`packages/dashboard/src/ui/contract.ts`) has its own version, separate from
pxsig's. A UI adapter records the version it was written for in its `conformance.json`
(`"contract": "1.0.0"`; an adapter without the field counts as 1.0.0), and `pxsig dashboard gaps`,
`pxsig dashboard build` and `pxsig serve` compare it with this pxsig's:

| The adapter is written for               | What happens                                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| the same version                         | nothing to do                                                                                                                            |
| an older minor version (1.0 against 1.2) | it builds and works; `gaps` names what was added since, which renders its fallback or default until the adapter maps it                  |
| an older major version (1.x against 2.0) | `gaps` reports a problem and `build` refuses, with the migration notes of each major version below; `serve` keeps the prebuilt dashboard |
| a newer version                          | a note: parts newer than this pxsig's contract are unused                                                                                |

**Minor:** a new optional component or prop with a fallback, a new token or icon with a default.
**Major:** a component or prop removed or changed in meaning, a new required component, a token or
icon without a default. A major version's section starts with its migration notes.

`pnpm ui:check` holds the version to `src/ui/contract-lock.json`: a change to the contract without
a version bump of the right size, or without a section here, fails. After the bump and the
section, `node scripts/ui.mjs lock` records the new contract.

## 1.4.0

Minor: one optional prop.

- **`keep`** on `NavLink`: the link never moves into the overflow menu; it stays in the bar at
  every width, and the other links move first. The dashboard sets it on Help. An adapter written
  for 1.3.0 ignores it, so Help moves into the menu like the other links at a narrow width.

## 1.3.0

Minor: three optional components, a set.

- **`SidePanelLayout`**, **`SidePanelMain`** and **`SidePanel`**: records (a table) and the
  details of the one selected, side by side; when the container is too narrow for both, the panel
  overlays the main area from the end edge, the main area keeping its full width underneath. `SidePanel` (`open`, `onOpenChange`, `title`, `headingLevel`,
  `closeLabel`) is not modal: a `complementary` landmark named by its title, closed by its close
  button and by Escape inside it; on open, focus moves into it, and back on close. The dashboard's
  React view (Diagnostics › React) uses them. The three are taken as a set: an adapter that exports
  all three draws its own, else all three render the fallback (an `<aside>` beside the table, as
  the inspector's side panel, overlaid on it when narrow), so an adapter written for 1.2.0 or 1.1.0 keeps working.

## 1.2.0

Minor: two optional props.

- **`disabled`** on `Switch` and `Slider`: shown but not operable. A disabled control keeps its
  role, name and value (announced as unavailable, not hidden), does not call `onCheckedChange` /
  `onValueChange`, and is drawn at 0.5 opacity. Without it (an adapter written for 1.1.0) the
  dashboard draws that control with the built-in fallback while it is disabled, so it is never
  operable when it should not be.

## 1.1.0

Minor: one optional component.

- **`Tooltip`** (`content`, `children`): a short hint on hover of one element. The dashboard puts
  the pxsig, engine and UI contract versions on the "pxsig" mark in the top bar with it. Without it
  the hint is the element's native `title`, which the fallback sets; the Help section shows the same
  versions as text.

## 1.0.0

The contract as it is today: 43 components (17 required), 38 tokens and 12 icons, with the 11 rules
in `contract.ts`. Every adapter written before the contract had a version is a 1.0.0 adapter.
