### Behaviour changes

- **UI contract 1.7.0: the top bar's responsive rules, and a name for More.** The dashboard now
  decides what its top bar shows by measuring the bar, not by fixed container-query widths: as it
  narrows, the last check goes first, then the modes tag, then the review status beside the review
  button; then the workspace label is capped at 24ch (always below 1024px); then the section links
  move into More (Help kept); then the label truncates; then the end controls go compact (the
  project picker narrows, the review button takes a short label, the connection and the status
  become their glyphs). Widening reverses it, and a wider bar never shows fewer links or controls.
  The last check now shows whenever every link fits beside it, and while it is hidden the
  connection badge's hint and accessible name carry it. The bar is one line from 1440 down to 390
  CSS px with no sideways scroll, and every section is reachable down to 640px. `NavList` takes a
  new optional prop, `moreLabel`: the More trigger's accessible name from pxsig's copy ("More
  sections"). `pxsig dashboard check` sweeps the bar over widths with a new rule, `top-bar`, which
  fails the check on a label taking two lines, Help or More clipped or covered, a section missing
  from both the bar and More, More out of order, fewer links on a wider bar, or a sideways scroll;
  `pnpm screens:check` fails on it too. `pxsig dashboard gaps` reports an adapter's `topBar`
  declaration. The plain adapter (and examples/custom-ui) draws its More menu in a portal into
  the bar's `<nav>` (a landmark), named by `moreLabel`, with its items at the small control size,
  and closes it on Escape from the trigger too. The hydrotik adapter (the bundled dashboard) now names More from pxsig's copy too:
  it passes `moreLabel` to the design system's `NavItems`, so its trigger and menu are "More
  sections" (they were "More navigation"), and its `topBar` declaration meets every rule. The
  `one-line` region rule no longer counts an open More menu that an adapter draws inside the bar
  (a portal into the nav) as part of the bar's line, and the `overlap` layout rule no longer
  reports the page's controls under an open menu (its own items still may not overlap).
  To update: an adapter written for 1.6.0 keeps building, but check its top bar against "Top bar"
  in docs/ui/build-adapter.md: `TopNav` must put `className` on the bar's root (with the brand, the
  `NavList` and the `NavEnd` side by side in it); each link and the More trigger one line at its
  natural width (`white-space: nowrap`, `flex-shrink: 0`); links measured again on resize, font
  load and a label or count change; the list `flex: 1 1 0`, never narrower than More and the kept
  link, clipping; the More menu not cut by that clipping; `NavEnd` after the list, never wrapping.
  Name the More trigger (and its menu) with `moreLabel`, add a `topBar` object to conformance.json
  (one key per rule: `root`, `oneLine`, `measure`, `list`, `more`, `keyboard`, `moreLabel`, `end`,
  each `true` or a note), set `"contract": "1.7.0"`, rebuild, and run `pxsig dashboard check`: fix
  any `top-bar` finding it lists.

### Documentation

- **"Top bar" in docs/ui/build-adapter.md**: the collapse order, the minimum supported width (640px,
  graceful to 390px), More's contents, placement and keyboard, and what an adapter's `TopNav`,
  `NavList` and `NavEnd` must do; the `TopNav`, `NavList`, `NavLink` and `NavEnd` sections say the
  same. `NavEnd`'s section no longer says the dashboard hides its children with container queries
  on its `className`. docs/ui/features.md lists the top bar's wide, narrow and compact states.
