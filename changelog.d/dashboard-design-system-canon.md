### Changed

- **The dashboard draws the design system's components as the design system draws them.** The
  reference adapter maps the UI contract's props onto hydrotik's and no longer re-styles them:
  `info` badges use the design system's default (primary) badge and `neutral` badges its secondary
  one; the side panel is hydrotik's `auto` mode (pushed in beside the records, overlaid below the
  layout's `lg` step, 64rem, where it was 60rem), with focus moved into it on open; an alert is a
  non-live region named by its label, whose title is not a heading, its title drawn in the text
  colour as the design system draws it; stat cards draw their own corner arrow, keep their accent
  edge for `success`, `warning` and `danger`, and their widths land on whole pixels. Hover fades
  take the design system's 100ms (`motion.fast`, 120ms before). The top bar's count that asks for
  action keeps its look (a neutral wash with digits in the primary colour) until the design
  system's subtle count is pinned. The design system is pinned at a newer commit.
- **UI contract 1.10.0:** a `StatGroup` item takes `affordance` (`filter` | `link`), for a design
  system whose stat card draws its own corner arrow; the dashboard passes it beside `icon`. An
  adapter written for 1.9.0 or earlier keeps drawing `icon`
  ([contract changes](../docs/ui/contract-changes.md#1100)).
- **`pnpm ui:check` holds the reference adapter to prop mapping:** no styles of its own, no
  stylesheet but the design system's, and inline styles for layout glue only. The four
  stylesheets it still needs are listed with what each waits on.
- **`pnpm ui:check` holds every dashboard style to layout glue on design-system elements:** a
  contract component's class or inline style, a global selector on a design-system hook and a
  focus rule other than the shared focus lines are found wherever they are in the dashboard. The
  ones that exist today are listed in `ui-tools/ds-reach-pending.json`, each with what it waits
  on; the list only shrinks.
