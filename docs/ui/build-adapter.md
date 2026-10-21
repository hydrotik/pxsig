# Building a UI adapter

Instructions for building the pxsig dashboard on your own design system. They are written to be
followed step by step, by a person or by a coding agent. Follow them in order, answer the mapping
questions for each component from your design system's documentation, and check each acceptance
criterion before moving on.

The dashboard renders through a contract of 42 neutral components. An adapter is one module that
implements them on your design system. Nothing in the dashboard's views changes; the adapter is
chosen once, at build time.

## Before you start

Read, in `node_modules/pxsig/` (or `packages/dashboard/` in a clone of pxsig):

| File | What it gives you |
| --- | --- |
| `dashboard/src/ui/contract.ts` | Every component's props, as TypeScript, and the 11 contract rules. The source of truth: where this page and the contract differ, the contract wins. |
| `dashboard/src/ui/tokens.ts` | The neutral theme tokens your adapter must map. |
| `docs/ui/features.md` | Every dashboard feature and the components it renders: what your components will be used for. |
| `dashboard/src/ui/adapters/hydrotik/` | The reference adapter: a worked mapping onto a real design system. |
| `dashboard/src/ui/fallbacks.tsx` | What each optional component looks like when you leave it out. |

The types are importable: `import type * as C from 'pxsig/dashboard'`.

## Set up

1. Create a folder in your project, for example `pxsig-ui/`, with an `index.tsx`.
2. Name it in the project's `pxsig.config.json`: `{ "dashboard": { "ui": "./pxsig-ui" } }`.
3. Install the build's tools as devDependencies: `vite`, `@vitejs/plugin-react`,
   `@vanilla-extract/vite-plugin`, `react`, `react-dom`.
4. The module's named exports are:
   - `name`: a short name for reports.
   - `tokens`: a `TokenMap`, a CSS value for every token (see [Tokens](#tokens)).
   - the components, each a React component taking the contract's props.
5. Beside it, `conformance.json` says how fully you cover each component:

   ```json
   { "adapter": "acme", "components": { "Button": { "status": "full", "note": "Acme Button" } } }
   ```

   Status is `full` (your design system's component, all behaviour), `partial` (some behaviour
   missing: say which in the note), `bespoke` (built for the adapter from primitives) or `missing`.
6. Optional: a `vite.mjs` whose default export returns build settings your design system needs:
   `{ alias: { name: path }, allow: [folders], optimizeDepsExclude: [names] }`.

Run `pxsig dashboard gaps` at any point: it lists what is missing, partial and bespoke, and the
dashboard files each one affects.

## Contract rules

1. **Emphasis and tone are separate props.** `emphasis` is how loud (`solid`, `outline`, `ghost`,
   `subtle`); `tone` is the state, from one vocabulary everywhere: `neutral | info | success |
   warning | danger`. Map each pair to your nearest variant; never invent a colour.
2. **The dashboard owns its domain.** Verdicts (pass, changed, new…) and coverage codes reach you
   as a tone, an icon name and a label. Do not interpret them.
3. **Size is a hint.** `sm` or `md`. Density is set once, by your provider. A control inside a
   `Toolbar` with no `size` takes the toolbar's size.
4. **Compound parts are prefixed exports** (`Card`, `CardHeader`, …). If your design system has one
   component with props or slots instead, collapse the parts inside your adapter.
5. **Value callbacks, controlled inputs, data-driven choices.** `onValueChange(value)`, never an
   event; `value` is always controlled; choices come as `options`.
6. **Neutral table columns.** `DataTable` takes `{ id, header, field, cell, align, width }`; translate
   to your grid's column type inside the adapter.
7. **Theme mode is the runtime's.** Your `UiProvider` receives `mode` and applies it; it never
   stores or changes it.
8. **Icons are a closed set of names.** Map each to a glyph of your icon set.
9. **One chart component.** `Chart` with `kind="bar" | "line"`. Without a chart library, leave it out:
   the fallback shows the numbers as a table.
10. **Every token is required.** A design system without a group (motion, letter-spacing) maps it to
    a literal value.
11. **Links take `render`** for router integration.

Every component that takes `className` must put it on its root element: the dashboard positions
those components with its own classes.

## Build order

1. `tokens` and `UiProvider`. Build with only these and the required components stubbed: the
   dashboard's own layout (cards, story thumbnails, the image stage) should already look right in
   both themes.
2. Shell: `TopNav`, `NavList`, `NavLink`, `NavEnd`, `AppShell`, `AppMain`.
3. Core: `Button`, `IconButton`, `Card` and its parts, `Badge`, `StatusBadge`, `Icon`, `StatGroup`,
   `DataTable`.
4. Controls: `Dialog` and its parts first (the inspector), then `Select`, `SegmentedChoice`,
   `Toolbar` and its parts, `Slider`, `Switch`, `SearchField`, `Progress`, `KeyValueList`,
   `KeyValueItem`, `Alert` and its parts, `Link`, `CopyValue`, `Kbd`.
5. `Chart`.
6. The diff viewer's colours: [Styling the diff viewer](#styling-the-diff-viewer).
7. [Verify](#verify).

## Tokens

The dashboard's own stylesheets read `var(--pxsig-<group>-<name>)`; your `tokens` map gives each a
value. Point colours at your design system's CSS variables so they follow the theme mode; a
literal colour does not switch with it.

| Group | Names | Used for |
| --- | --- | --- |
| `color` | `background`, `surface`, `surfaceRaised`, `border`, `text`, `textMuted`, `accent`, `focus`, `hover`, `success`, `warning`, `danger` | page, cards, the transparency checker, edges, text, links and selection, focus outlines, hover washes, verdict edges |
| `space` | `0_5`, `1`, `1_5`, `2`, `2_5`, `3`, `4`, `5`, `6`, `8`, `12` | gaps and padding; `1` is 0.25rem in the reference |
| `radius` | `sm`, `md`, `lg` | corners |
| `font` | `sans`, `mono` | families |
| `fontSize` | `3xs`, `2xs`, `xs`, `sm`, `lg` | micro labels to section titles |
| `fontWeight`, `lineHeight`, `letterSpacing` | `semibold`, `relaxed`, `caps` | headings, running text, tracked caps |
| `line` | `emphasis` | the verdict edge on a card (2px in the reference) |
| `motion` | `fast` | hover colour changes (120ms in the reference) |

Mapping questions: Which of your variables switch with the theme? Which of your surfaces is a
card and which a page? Is your accent accessible on both backgrounds?

Acceptance: `pnpm ui:check` in pxsig or a TypeScript check in your project reports no missing token;
the dashboard's story cards, help drawings and image stage use your colours in both themes.

## Components

Required components must be exported, or the build stops and names them. Optional ones fall back
to a plain rendering. Each section: purpose, props (see `contract.ts` for the types), behaviour,
accessibility, the questions to answer when mapping, and the acceptance check.

## Shell components

### `UiProvider`

- **Purpose**: the root of your design system: theme mode, density, fonts, and any context your
  components need (tooltips, portals, toasts).
- **Props**: `mode` (`light` | `dark`), `children`.
- **Behaviour**: apply `mode` whenever it changes, usually as a class or attribute on `<html>`.
  Load fonts here.
- **Accessibility**: set `color-scheme` to match the mode.
- **Mapping questions**: How does your design system switch theme? Does it need a provider for
  tooltips or portals? Where do its fonts load?
- **Acceptance**: the theme toggle in the top bar switches every component and the page background.
  Optional: the fallback sets `data-theme` and `color-scheme` on `<html>`.

### `AppShell`

- **Purpose**: the page frame: the top bar above a scrolling main region, filling the viewport.
- **Props**: `children` (a `TopNav`, then an `AppMain`).
- **Behaviour**: a column the height of the viewport; the main region scrolls, the bar does not.
- **Accessibility**: no landmark of its own.
- **Mapping questions**: Does your design system have an app frame or layout component?
- **Acceptance**: scrolling a long section keeps the top bar in place. Optional (fallback: a flex column).

### `AppMain`

- **Purpose**: the main region and the page's scroll container.
- **Props**: `ref` (to a `<main>`), `children`.
- **Behaviour**: render a `<main>` element and forward `ref` to it; the dashboard scrolls it to the
  top when the section changes.
- **Accessibility**: exactly one `<main>`.
- **Mapping questions**: Does your frame's content slot accept an element of your choice
  (`asChild`, `render`, `as`)?
- **Acceptance**: changing section starts at the top. Optional.

### `TopNav`

- **Purpose**: the top bar: the report's mark, the section links, the pinned controls.
- **Props**: `label` (the navigation landmark's name), `brand` (the mark: a heading and a tag),
  `className`, `children` (a `NavList`, then a `NavEnd`).
- **Behaviour**: one row. When the links do not fit, the ones that do not fit move into an
  overflow menu if your navigation has one.
- **Accessibility**: a `<nav>` named by `label`.
- **Mapping questions**: Does your navbar take a logo slot? Does it handle overflow, and how does
  it find its items (some measure children by element type: then translate `NavLink`s inside
  `NavList`, as the reference adapter does)?
- **Acceptance**: every section is reachable at 1280px and at 800px wide. Required.

### `NavList`

- **Purpose**: the section links.
- **Props**: `children` (`NavLink`s, possibly `null`).
- **Behaviour**: ignore `null` children; keep the order.
- **Accessibility**: a list of links.
- **Mapping questions**: What is your navbar's item container?
- **Acceptance**: the links render in order, with the current one marked. Required.

### `NavLink`

- **Purpose**: one section link, with an optional count.
- **Props**: `href` (`#<section>`), `active`, `count`, `countTone` (`info`: asks for action;
  `neutral`: a plain total), `countLabel` (the link's accessible name with its count), `children`.
- **Behaviour**: a plain link: the dashboard follows the hash. No count at zero; cap long counts
  (99+).
- **Accessibility**: `aria-current="page"` when `active`; when there is a count, the accessible name
  includes it (use `countLabel`).
- **Mapping questions**: Does your nav item take a count or badge? Which tone is your attention
  colour?
- **Acceptance**: Back and Forward move between sections; a screen reader reads "Review Stories, 6
  to review". Required.

### `NavEnd`

- **Purpose**: the controls pinned at the end of the bar.
- **Props**: `className`, `children`.
- **Behaviour**: a row that does not shrink. The dashboard hides some of its children at narrow
  widths with container queries on `className`.
- **Accessibility**: none of its own.
- **Mapping questions**: Does your navbar have an end slot?
- **Acceptance**: the review button, connection badge, theme toggle and status stay on the right.
  Optional (fallback: a `<div>`).

## Core components

### `Button`

- **Purpose**: a command, or a link that looks like one.
- **Props**: `emphasis` (`solid` default, `outline`, `ghost`), `size`, `disabled`, `title`,
  `aria-label`, `onClick`, `href` + `external`, `children`.
- **Behaviour**: with `href`, render an `<a>` styled as the button; `external` opens a new tab
  (`target="_blank" rel="noreferrer"`). Without `size`, inherit the toolbar's.
- **Accessibility**: a native `<button type="button">` or `<a>`; visible focus outline; disabled is
  `disabled`, not just styled.
- **Mapping questions**: Which variants are solid, outline and ghost? How does your button render as
  a link? Does it pick up a toolbar's size?
- **Acceptance**: the inspector's "Storybook" link is an `<a>` that looks like the buttons beside it;
  disabled review buttons cannot be clicked. Required.

### `IconButton`

- **Purpose**: a square button with a glyph or one character (‹ › − +).
- **Props**: `label` (accessible name), `title`, `emphasis` (`outline` default, `ghost`), `size`,
  `disabled`, `onClick`, `children`.
- **Behaviour**: square at the row's height.
- **Accessibility**: `aria-label` from `label`; the glyph is decorative.
- **Mapping questions**: Does your design system have an icon-button size?
- **Acceptance**: the zoom and navigation buttons are square and match the height of the buttons
  beside them. Required.

### `Card`

- **Purpose**: a titled region of a page.
- **Props**: `children` (`CardHeader`, `CardContent`).
- **Behaviour**: a surface with a border or elevation, full width of its column.
- **Accessibility**: no landmark; the title is a heading.
- **Mapping questions**: Card, panel or tile: which one holds tables and charts?
- **Acceptance**: Overview's "Open items" sits on a card. Required.

### `CardHeader`

- **Purpose**: the card's header: title and description.
- **Props**: `children`.
- **Behaviour**, **Accessibility**: as your design system's card header.
- **Mapping questions**: Is the header a separate part or props of the card?
- **Acceptance**: title and description stack with your spacing. Required.

### `CardTitle`

- **Purpose**: the card's heading.
- **Props**: `children`.
- **Behaviour**: one line of heading text.
- **Accessibility**: a heading element at your design system's level for a card.
- **Mapping questions**: Which heading level does your card title use?
- **Acceptance**: the headings outline of a section reads sensibly. Required.

### `CardDescription`

- **Purpose**: a line of muted text under the title.
- **Props**: `className`, `children` (text, sometimes with `<code>`).
- **Behaviour**: muted, wraps.
- **Accessibility**: plain text.
- **Mapping questions**: Does your description take a class (the dashboard sets monospace on one)?
- **Acceptance**: a scenario's change description shows in monospace. Required.

### `CardContent`

- **Purpose**: the card's body.
- **Props**: `children` (tables, charts, lists).
- **Behaviour**: padding consistent with the header.
- **Accessibility**: none.
- **Mapping questions**: none beyond the card.
- **Acceptance**: tables fill the card's width. Required.

### `StatGroup`

- **Purpose**: a row of key figures; some are buttons that filter or navigate.
- **Props**: `label`, `items` (`label`, `value`, `unit`, `tone`, `onSelect`, `active`, `icon`),
  `layout` (`cards` default, `strip`: one band inside a card), `className`.
- **Behaviour**: items wrap; a `tone` colours the value or edge; an item with `onSelect` is a
  button (`active` is pressed); `icon` sits in its corner.
- **Accessibility**: a region named by `label`; selectable items are buttons with `aria-pressed`
  when they filter.
- **Mapping questions**: Do you have a stat or KPI component? Can its tiles be buttons? Which tones
  does it colour?
- **Acceptance**: on Coverage, a count with a corner arrow filters the table below and shows as
  pressed. Optional (fallback: plain tiles).

### `DataTable`

- **Purpose**: records as rows, sortable by the columns with a `field`.
- **Props**: `rows`, `rowId`, `columns` (`id`, `header`, `field`, `cell(row)`, `align`, `width`),
  `onRowClick`, `search`, `paginate` (`false`: every row).
- **Behaviour**: a column with `field` sorts by it; `cell` renders the cell, else the field's value;
  `onRowClick` makes rows activatable; `search` adds a search field (and a column chooser if you
  have one). Use compact density.
- **Accessibility**: a real `<table>` or the ARIA table pattern; sortable headers announce their
  sort; activatable rows respond to Enter as well as a click.
- **Mapping questions**: What is your grid's column type? How are row clicks and keyboard row
  activation done? Is paging on by default?
- **Acceptance**: on Accessibility, clicking or pressing Enter on a rule opens its entries; sorting
  by Entries works. Optional (fallback: a plain sortable table).

### `StatusBadge`

- **Purpose**: a state: icon, tone and label (verdicts, impacts, coverage codes).
- **Props**: `tone`, `icon` (an `IconName`), `label`, `title`, `className`.
- **Behaviour**: icon then label, the icon in the tone's colour; the label in text colour.
- **Accessibility**: the label is always visible text; the icon is decorative.
- **Mapping questions**: Does your status component take a custom icon and tone, or only presets?
  If only presets, map (tone, icon) to the nearest preset and say so in the conformance note.
- **Acceptance**: the inspector header shows "✓ Pass" in success colour; Help lists every verdict.
  Required.

### `Badge`

- **Purpose**: a short tag (mode, state, "New", connection), not a count of work.
- **Props**: `tone` (`neutral` default), `emphasis` (`subtle` default, `outline`, `solid`), `pulse`
  (live indicator), `title`, `className`, `children`.
- **Behaviour**: inline, small type.
- **Accessibility**: text; `pulse` must respect reduced motion.
- **Mapping questions**: Which of your badge variants is subtle, outline and solid? Is there a live
  or pulsing dot?
- **Acceptance**: story cards show the mode as an outline tag; the connection badge pulses when live.
  Required.

### `Icon`

- **Purpose**: a glyph from the closed set: `check`, `alert`, `dot`, `ban`, `pause`, `dashed`, `cross`,
  `sun`, `moon`, `arrow-down-left`, `arrow-up-right`, `external`.
- **Props**: `name`, `size` (a CSS size), `className`.
- **Behaviour**: inline, the current text colour.
- **Accessibility**: always `aria-hidden`; the text beside it carries the meaning.
- **Mapping questions**: Which glyph in your set matches each name?
- **Acceptance**: the theme toggle shows a moon in light mode and a sun in dark. Required.

## Controls

### `Dialog`

- **Purpose**: a modal dialog: the inspector (full screen) and the review summary.
- **Props**: `open`, `onOpenChange(open)`, `initialFocus` (a ref), `className`, `children`.
- **Behaviour**: modal; Esc and the backdrop call `onOpenChange(false)`; no close button of its own
  (the dashboard renders Close). On open, focus `initialFocus` instead of the first control, without
  a focus ring.
- **Accessibility**: `role="dialog"`, `aria-modal`, named by its `DialogTitle`; focus is trapped and
  returns on close.
- **Mapping questions**: Can your dialog hide its close button? Can it be sized to the viewport by a
  class? How do you choose the element focused on open?
- **Acceptance**: opening an entry focuses its title; Esc closes it; Tab never leaves it. Required.

### `DialogTitle`

- **Purpose**: the dialog's accessible name.
- **Props**: `ref`, `tabIndex` (the inspector passes `-1` to focus it), `className`, `children`.
- **Behaviour**, **Accessibility**: a heading that names the dialog (`aria-labelledby`).
- **Mapping questions**: Does your title forward `ref`?
- **Acceptance**: a screen reader announces the entry id on open. Required.

### `DialogDescription`

- **Purpose**: the dialog's description (the entry's reasons).
- **Props**: `className`, `style`, `children`.
- **Behaviour**, **Accessibility**: as your design system's dialog description.
- **Mapping questions**: none.
- **Acceptance**: the reasons show under the id. Required.

### `Slider`

- **Purpose**: one number on a range: tolerance, swipe position, opacity, cell strength.
- **Props**: `label`, `value`, `onValueChange(value)`, `min`, `max`, `step`, `formatValue`,
  `className`.
- **Behaviour**: shows the label and the formatted value; dragging and arrow keys change it.
- **Accessibility**: `role="slider"` (or a native range input) named by `label`, with
  `aria-valuetext` from `formatValue`.
- **Mapping questions**: Does your slider take a single number or an array? Does it show its value?
- **Acceptance**: in the inspector, moving Tolerance updates the changed-pixel count. Optional
  (fallback: a range input).

### `Switch`

- **Purpose**: an on / off control (highlight, regions, tiles, details).
- **Props**: `checked`, `onCheckedChange(checked)`, `label` (accessible name; the visible text is
  in the caller's `<label>`).
- **Behaviour**: toggles on click and Space.
- **Accessibility**: `role="switch"` with `aria-checked`.
- **Mapping questions**: Is your switch a button or a checkbox? Does it accept an accessible name?
- **Acceptance**: turning Regions off hides the region outlines. Optional (fallback: a checkbox
  with `role="switch"`).

### `SegmentedChoice`

- **Purpose**: exactly one of a few visible options (inspector view mode, variants, diagnostics
  parts).
- **Props**: `label`, `value`, `onValueChange(value)`, `options` (`value`, `label`,
  `accessibleLabel`, `title`).
- **Behaviour**: never calls back with nothing selected (ignore deselection).
- **Accessibility**: a group named by `label`; the selected option is pressed or checked; arrow keys
  move between options if your component supports it.
- **Mapping questions**: Toggle group, segmented control or tabs? Can it be deselected (then guard
  it)?
- **Acceptance**: keys 1–5 in the inspector and clicks on the options switch the view, and the
  selection follows. Optional (fallback: pressed buttons).

### `Toolbar`

- **Purpose**: a row of controls sharing one size and one line.
- **Props**: `size`, `className`, `children` (`ToolbarStart`, `ToolbarEnd`).
- **Behaviour**: wraps on narrow widths; passes `size` to the controls inside.
- **Accessibility**: `role="toolbar"` if your design system adds it.
- **Mapping questions**: Does your toolbar propagate a size to its controls?
- **Acceptance**: the Stories filters, their labels and the count line up. Optional.

### `ToolbarStart`

- **Purpose**: the toolbar's leading group.
- **Props**: `children`. **Behaviour**: a row at the start. **Accessibility**: none.
- **Mapping questions**: left / start slot name.
- **Acceptance**: controls start at the left edge. Optional.

### `ToolbarEnd`

- **Purpose**: the toolbar's trailing group.
- **Props**: `children`. **Behaviour**: a row pushed to the end. **Accessibility**: none.
- **Mapping questions**: right / end slot name.
- **Acceptance**: the Stories count sits at the right end. Optional.

### `ToolbarField`

- **Purpose**: a labelled control in a toolbar.
- **Props**: `label`, `minInlineSize`, `grow`, `children` (one control).
- **Behaviour**: labels share a top edge, controls a bottom edge; `grow` takes the free space.
- **Accessibility**: the label names the control (a `<label>` wrapping it, or `aria-labelledby`).
- **Mapping questions**: Do you have a form-field component that works inline?
- **Acceptance**: each Stories select is announced with its label. Optional.

### `ToolbarSummary`

- **Purpose**: a count or note on the toolbar's control line.
- **Props**: `live`, `children`.
- **Behaviour**: aligned with the controls' baseline, muted.
- **Accessibility**: `aria-live="polite"` when `live`.
- **Mapping questions**: none.
- **Acceptance**: "1,024 of 1,024" updates as the search narrows. Optional.

### `CopyValue`

- **Purpose**: a command shown as code, with a copy button.
- **Props**: `value`.
- **Behaviour**: copies `value` to the clipboard and confirms briefly.
- **Accessibility**: the button is named; the confirmation is announced.
- **Mapping questions**: Do you have a copy-to-clipboard or code-snippet component?
- **Acceptance**: after rejecting an entry, the re-check command copies. Optional.

### `Kbd`

- **Purpose**: a keyboard key in the inspector's key help.
- **Props**: `children`. **Behaviour**: small keycap. **Accessibility**: a `<kbd>` element.
- **Mapping questions**: Do you have a Kbd component?
- **Acceptance**: the key strip under the stage shows keycaps. Optional.

### `Link`

- **Purpose**: a text link (the entry's files).
- **Props**: `href`, `external`, `title`, `className`, `render` (router integration: receives the
  anchor props, returns the element).
- **Behaviour**: `external` opens a new tab and is marked as doing so.
- **Accessibility**: a real `<a href>`; an external link says it opens a new tab (an icon with a text
  alternative, or visible text).
- **Mapping questions**: How does your link component mark external links? How does it integrate a
  router?
- **Acceptance**: the Files list opens each file in a new tab. Optional.

### `Progress`

- **Purpose**: a completion bar, 0–100 (review session, scenario detection).
- **Props**: `value`, `label`, `showLabel` (show the label and the percentage), `className`.
- **Behaviour**: fills to `value`%.
- **Accessibility**: `role="progressbar"` (or `<progress>`) named by `label`.
- **Mapping questions**: Does your progress bar show a label and value?
- **Acceptance**: the session bar fills as entries are decided. Optional.

### `KeyValueList`

- **Purpose**: label → value pairs (metrics, pixel changes, the session summary).
- **Props**: `orientation` (`vertical` default, `horizontal`), `labelWidth`, `children`.
- **Behaviour**: vertical: a label column of `labelWidth`; horizontal: pairs in a row.
- **Accessibility**: a description list (`<dl>`), or equivalent.
- **Mapping questions**: Do you have a description-list or property-list component?
- **Acceptance**: the inspector's Metrics align their values. Optional.

### `KeyValueItem`

- **Purpose**: one pair.
- **Props**: `label`, `children` (the value).
- **Behaviour**, **Accessibility**: a `<dt>` / `<dd>` pair or equivalent.
- **Mapping questions**: as `KeyValueList`.
- **Acceptance**: as `KeyValueList`. Optional.

### `Alert`

- **Purpose**: a message about the whole page (the coverage banner).
- **Props**: `tone` (`neutral` | `danger`), `label` (the region's name), `children`.
- **Behaviour**: full width, at the top of the page.
- **Accessibility**: a named region; do not use `role="alert"` (it is not urgent).
- **Mapping questions**: Which variant is destructive? Does it take an accessible name?
- **Acceptance**: with coverage errors, the banner shows on every section. Optional.

### `AlertTitle`

- **Purpose**: the alert's headline. **Props**: `children`. **Behaviour**: emphasised line.
- **Accessibility**: text. **Mapping questions**: none.
- **Acceptance**: the headline counts the components with errors. Optional.

### `AlertDescription`

- **Purpose**: the alert's body (setup problems, repair button).
- **Props**: `children`. **Behaviour**: block content. **Accessibility**: none.
- **Mapping questions**: Does your description accept block content (buttons)?
- **Acceptance**: the repair button sits in the banner. Optional.

### `SearchField`

- **Purpose**: a controlled search input (Stories).
- **Props**: `value`, `onValueChange(value)`, `placeholder`.
- **Behaviour**: updates on every keystroke; a clear button if you have one.
- **Accessibility**: `type="search"`, named by the surrounding `ToolbarField`.
- **Mapping questions**: Is your search input controlled with a value callback?
- **Acceptance**: typing narrows the cards at once. Optional.

### `Select`

- **Purpose**: one value from a list (filters, sort, project).
- **Props**: `value`, `onValueChange(value)`, `options` (`value`, `label`), `label` (accessible name
  when no field labels it), `size`, `inlineSize`.
- **Behaviour**: shows the selected option's label; lists `options`.
- **Accessibility**: a native `<select>` or the listbox pattern; keyboard selection.
- **Mapping questions**: Is your select built from parts (trigger, content, items)? Build them from
  `options`.
- **Acceptance**: the Result filter changes the cards; the project picker reads "Project". Required.

## Charts

### `Chart`

- **Purpose**: bar or line chart (Runs, Diagnostics).
- **Props**: `kind` (`bar`: horizontal grouped bars, one row per `x` category; `line`: lines over an
  ordered `x`), `data`, `series` (`key`, `label`), `x`, `format`, `max`, `height` (CSS),
  `className`.
- **Behaviour**: series take your categorical colours in order; a legend when there is more than one
  series; a tooltip on hover; `format` formats the value axis and tooltip.
- **Accessibility**: the numbers must be reachable without the picture: a tooltip alone is not
  enough. Give the chart an accessible summary, or a data table on demand.
- **Mapping questions**: Do you have a chart component, and on which library? Which tokens are your
  categorical colours?
- **Acceptance**: Runs shows changed entries per run as a line. Optional (fallback: a table of the
  numbers).

## Styling the diff viewer

The inspector's image stage is built on `pxsig/diff-viewer`, unstyled parts that every adapter
reuses unchanged. The dashboard styles it with the neutral tokens, so your `tokens` already colour
it: `color.border` frames and separates the panes, `color.background` and `color.surfaceRaised`
draw the transparency checker, `color.accent` the active region, the marker and the swipe line,
`color.warning` region outlines, `color.danger` changed tiles, `color.focus` the stage's focus
outline. Check them in both themes on an entry with changes.

To build your own stage, compose the parts: `Root` (state; no element), `Viewport` (pan, zoom,
probe), `Pane`, `Frame`, `Layer`, `Regions`, `Region`, `Marker`, `SwipeHandle`, `Probe`, `ModeGroup`,
`ZoomControls`. State is in `data-*` attributes (`data-mode`, `data-grabbing`, `data-pixelated`,
`data-active`, `data-checked`), geometry in custom properties on the viewport (`--dv-tx`, `--dv-ty`,
`--dv-zoom`, `--dv-split-x`, `--dv-marker-x`, `--dv-marker-y`, `--dv-marker-size`). Every part takes
`className` as a string or a function of its state; `ModeGroup` and `ZoomControls` take `render` to
draw them with your own segmented control and buttons.

## Verify

1. `pxsig dashboard gaps`: no problems, every required component present; each `partial` and
   `bespoke` has a note.
2. `pxsig dashboard build`: the build succeeds.
3. Serve it with your project's data (`PXSIG_DASHBOARD_DIR=<out> pxsig serve`) and walk
   [features.md](features.md) section by section in both themes: every state, interaction and key.
4. Side by side with the reference: open the same project in the prebuilt dashboard (`pxsig serve`
   without `PXSIG_DASHBOARD_DIR`) and compare each section and the inspector on one entry with
   changes. Layout and behaviour should match; only the look differs.
5. Run axe on each section and the open inspector: no violations.
6. Update `conformance.json` with what you found.
