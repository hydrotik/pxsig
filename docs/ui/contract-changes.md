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

## 1.9.0

Minor: two optional props.

- **`Chart` `label` and `summary`**: the chart's accessible name (the title of its card) and its
  data in one line of text, both from pxsig's copy and the chart's own data: a line's range per
  series ("Changed entries per run, 14 runs: 3 to 12.", the value alone when flat), each bar's
  value ("Time per compare: CLI process 3 ms, Server request 120 ms."), or "no data". A chart is
  not a tab stop unless it is interactive. The dashboard's charts are: the arrow keys move the
  tooltip. So the chart is one tab stop named by `label` and described by `summary`, text
  with the `hidden` attribute (read once, as the description), with nothing else in it focusable or unnamed (on recharts 3: its keyboard layer,
  `accessibilityLayer`, on, which makes the SVG the tab stop with `role="application"`, and
  `aria-label` and `aria-describedby` on the chart, which recharts puts on that SVG). The text is
  never drawn, so no screen moves. An adapter written for 1.8.0 or earlier keeps working and leaves the chart
  unnamed; the fallback table takes both.

## 1.8.0

Minor: a region rule allows more.

- **A `StatGroup` item may show its tone as a start edge too.** Region rule R4, for stat cards: the
  tone colours the item's value (as before), and an adapter may also draw a start edge (a border on
  the inline-start side, or a `::before` / `::after` at most 4px wide) in that tone's own colour.
  The label, the background and the other borders stay neutral, and an edge needs the value in the
  same tone: `pxsig dashboard check` reads an item's tone from its value's colour, so an edge in
  another tone's colour, an edge beside a neutral value, or a wash still breaks R4. pxsig's own
  dashboard (the reference adapter) draws its design system's 2px accent edge for `success`,
  `warning` and `danger` again, as it did before 0.7.7. An adapter written for 1.7.0 or earlier
  keeps working: a stat card whose tone colours only its value still passes.

## 1.7.0

Minor: one optional prop, and the top bar's rules written down.

- **`NavList` `moreLabel`**: the More trigger's accessible name ("More sections"), from pxsig's copy.
  The trigger may draw an icon or text, as the adapter chooses; its menu takes the same name. An
  adapter written for 1.6.0 keeps working and names its trigger itself; `pxsig dashboard gaps` then
  says so.
- **The top bar's responsive rules** ([build-adapter.md, "Top bar"](build-adapter.md#top-bar)):
  what an adapter's `TopNav`, `NavList` and `NavEnd` must do so that the bar stays one line from
  1440px down to 390px, with every section reachable down to 640px. The dashboard now decides which
  end controls show by measuring the bar (`data-collapse` and `data-compact` on its root), not by
  container queries on `TopNav`'s class; `pxsig dashboard check` sweeps the bar over widths with a
  new rule, `top-bar`. An adapter declares how it meets them in its conformance.json (`topBar`).

## 1.6.0

Minor: a region rule allows more; no component or prop changes.

- **A `Badge` may show its tone as its design system draws it.** Region rule R4 allows either, for
  badges only: a tone colours the badge's text (as before), or its wash, border and dot, in that
  tone's own colour. Its text keeps WCAG AA contrast (4.5:1) on its background. A badge drawn in
  another tone's colour than the one passed still breaks R4. Stat cards, status badges and top-bar
  counts are unchanged. The dashboard adds `pxsig-ui-tone-<tone>` to a badge's `className`, so
  `pxsig dashboard check` knows which tone it was given. An adapter written for 1.5.0 or earlier
  keeps working: a badge whose tone colours its text still passes.

## 1.5.0

Minor: one optional component.

- **`TextField`** (`label`, `value`, `onValueChange`, `maxLength`, `placeholder`, `onSubmit`,
  `autoFocus`): a controlled single-line text input with a visible label, which is also its
  accessible name (the placeholder is a hint, never the name). Enter calls `onSubmit` with the
  value, except while an input method is composing; `maxLength` caps what can be typed. Not a
  search field: no search role. Nothing renders it yet; the reason on Reject will. An adapter
  written for 1.4.0 or earlier keeps working: the fallback draws a native `<label>` above a native
  text `<input>`.

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
