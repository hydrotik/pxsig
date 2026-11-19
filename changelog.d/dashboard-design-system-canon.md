### Changed

- **The dashboard draws the design system's components as the design system draws them.** The
  reference adapter maps the UI contract's props onto hydrotik's and no longer re-styles them:
  `info` badges use the design system's default (primary) badge and `neutral` badges its secondary
  one; a top-bar count that asks for action is the design system's filled attention count; the side
  panel is hydrotik's `auto` mode (pushed in beside the records, overlaid below the layout's `lg`
  step, 64rem, where it was 60rem), with focus moved into it on open; an alert is a non-live block
  whose title is not a heading, its title drawn in the text colour as the design system draws it;
  stat cards draw their own corner arrow, and their widths land on whole pixels. Hover fades take the design
  system's 100ms (`motion.fast`, 120ms before). The design system is pinned at a newer commit.
- **UI contract 1.8.0:** a `StatGroup` item takes `affordance` (`filter` | `link`), for a design
  system whose stat card draws its own corner arrow; the dashboard passes it beside `icon`. An
  adapter written for 1.7.0 keeps drawing `icon` ([contract changes](../docs/ui/contract-changes.md#180)).
- **`pnpm ui:check` holds the reference adapter to prop mapping:** no styles of its own, no
  stylesheet but the design system's, and inline styles for layout glue only. The three
  stylesheets it still needs are listed with what each waits on.
