# A dashboard on any design system

Signed off 2026-10-21. Implemented in phases 1–4; the notes at the end record where the build
differs from this plan.

## Goal

The pxsig dashboard renders with one design system today, bundled into a black-box build. A team
on a different design system should be able to build the same dashboard on theirs: the same views
and behaviour, their components, selected **once at build time** (no switch in the UI), with an LLM
doing most of the adapter work from prescriptive instructions.

## Shape

```
packages/dashboard/src/
  ui/
    contract.ts        DS-agnostic interfaces: the props and semantics each UI component must honour
    index.ts           the active surface: re-exports the build-selected adapter + the contract types
    manifest.json      GENERATED: every contract component, its role, and the views that use it
    adapters/
      hydrotik/        the reference adapter on @hydrotik/design-system (today's look, unchanged)
        index.tsx
        conformance.json   per component: full | partial | bespoke | missing, with a note
    README.md          the contract, how to add an adapter, how to build with it
  diff-viewer/         Base UI-style compound primitives for the image stage (no design system)
  views/ parts/ inspector/ App.tsx   import components only from "@ui"
```

### 1. The contract and the adapter switch

- **Views depend only on `@ui`.** Every `@hydrotik/*` import in views, parts, the inspector and
  `App.tsx` moves behind the contract; a check (`pnpm ui:check`) fails if a design-system import
  appears outside `src/ui/adapters/<name>/`.
- **Build-time selection:** `PXSIG_UI_ADAPTER=<name>` or, in a consumer project,
  `pxsig.config.json` → `"dashboard": { "ui": "./pxsig-ui" }` (a path to an adapter module). Vite
  aliases `@ui-adapter` to it. An unknown name or path fails fast with a clear message. Default:
  `hydrotik` when `PXSIG_DS_SOURCE` is set, else the built-in `plain` adapter.
- **Neutral names, minimal props.** Each contract component has a stable, minimal prop shape (only
  what the views pass) documented in `contract.ts`; the hydrotik adapter maps it to the real
  component. Generic names stay generic; domain names are neutral. Indicative groups (final list
  from the import inventory):

  | Group    | Components                                                                                                                                                                                          |
  | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Shell    | `UiProvider` (theme mode), `TopNav`, `NavLink`, `NavEnd`, `PageHeader`                                                                                                                              |
  | Core     | `Button`, `IconButton`, `Card` (+ header, title, description, content), `StatCard`, `DataTable` (custom cells), `VerdictBadge`, `Badge` (a tone label, not a count), `Icon` (named set)             |
  | Controls | `Dialog`, `SidePanel`, `Slider`, `Switch`, `SegmentedChoice`, `Toolbar` (+ start, end), `CopyValue`, `Kbd`, `Link`, `Progress`, `KeyValueList`, `Alert`, `SearchField`, `Select`, `Menu`, `Tooltip` |
  | Charts   | `BarChart` (horizontal bars), `LineChart`, `SeriesDef` — the chart library is an adapter detail                                                                                                     |

- **Contract rules** (informed by a real design system's capabilities, described neutrally):
  1. Emphasis and tone are separate props: `emphasis` (solid, outline, ghost) and one tone
     vocabulary everywhere: `neutral | info | success | warning | danger`.
  2. The dashboard owns its domain vocabulary: the verdict enum and the verdict → tone + icon +
     label table live in pxsig; adapters render only a tone, an icon and a label.
  3. Size is a hint; density is set once on the provider.
  4. Compound parts are prefixed exports (`Card`, `CardHeader`, …), never dot notation in the
     contract, and an adapter may collapse them into props.
  5. Value-style callbacks (`onValueChange(value)`), controlled inputs (search included), and
     data-driven choice components (`options`, `value`, `onValueChange`) rather than trigger /
     content parts.
  6. The data table takes a neutral column definition (id, header, cell renderer, sort, width), so
     no grid library's types leak into the contract.
  7. Theme mode is owned by the contract runtime (`useThemeMode()`), which passes it to the
     adapter's provider and to any component that needs it; adapters never own the setter.
  8. Icons are a closed union of names (`'check' | 'alert' | …`); each adapter supplies the map.
  9. Charts are one high-level component (`Chart kind="bar" | "line"`, data, series, legend,
     tooltip); an adapter whose design system has no charting brings its own.
  10. Every token group is required in the token map, motion and letter-spacing included; a
      design system without a group maps it to literal fallbacks.
  11. Links take a `render` prop for router integration.
- **Required or optional with a fallback.** A design system with gaps still builds: an optional
  component the adapter lacks falls back to a documented plain rendering, and the conformance
  report says so.
- **Theme tokens.** The dashboard's own stylesheets (`dashboard.css.ts` and two more) read
  `@hydrotik/tokens` `vars` directly. They move onto a small neutral token set (colour roles,
  spacing, radii, type, motion) exposed as CSS custom properties (`--pxsig-*`); each adapter maps
  those to its design system's tokens, and its provider sets theme mode. The reference adapter maps
  them to `vars`, so nothing renders differently.
- **`pnpm ui:gaps`** (and `pxsig dashboard gaps --ui <path>` for consumers): the generated
  manifest against an adapter's conformance file: missing, partial and bespoke components, and the
  views each one affects. The reference adapter is all `full` / `bespoke`.

### 2. Diff-viewer primitives

The image stage (today `inspector/Stage.tsx`, already design-system-free) becomes compound,
unstyled, accessible parts in the style of Base UI:

```tsx
<DiffViewer.Root baseline={…} latest={…} diff={…} mode="side-by-side" onModeChange={…}>
  <DiffViewer.Viewport>
    <DiffViewer.Layer kind="baseline" /> <DiffViewer.Layer kind="latest" /> <DiffViewer.Layer kind="diff" />
    <DiffViewer.Regions>{(r) => <DiffViewer.Region region={r} />}</DiffViewer.Regions>
    <DiffViewer.Marker />
  </DiffViewer.Viewport>
  <DiffViewer.Probe>{(px) => …}</DiffViewer.Probe>
  <DiffViewer.ModeGroup /> <DiffViewer.ZoomControls />
</DiffViewer.Root>
```

No CSS shipped: state as `data-*` attributes, geometry as CSS custom properties, `className` (string
or function of state) and `render` props; controlled and uncontrolled. Every adapter reuses it
unchanged and styles it with its own tokens. The help diagram (`parts/Schematic.tsx`) stays as it
is, also design-system-free.

### 3. Shipping, without new packages

- Subpath exports in `pxsig`: `pxsig/dashboard` (the contract types, for writing an adapter; types
  only, so loading it at run time throws) and `pxsig/diff-viewer` (TypeScript source for a bundler;
  React is an optional peer). No new npm packages.
- The dashboard's source (views, contract, diff viewer, the hydrotik adapter as the worked example)
  ships inside `pxsig`, so `pxsig dashboard build` can rebuild it against a consumer's adapter. The
  default prebuilt dashboard is unchanged.
- `@hydrotik/design-system` is **not** extracted or published: a consumer's adapter is written
  against the consumer's own design system, never hydrotik's.

### 4. Documentation that cannot go stale

- **Feature registry** (`ui/features.ts`, typed): every feature as data: section, purpose, states
  (loading, empty, error, offline, static report), interactions and keys, copy keys, and the
  contract components it renders.
- **Generated** `docs/ui/features.md` (the catalogue) and `src/ui/manifest.json` (component ↔ view
  use, from the imports).
- **Prescriptive build prompt** `docs/ui/build-adapter.md`: one section per contract component
  (purpose, props, behaviour, accessibility, the questions to answer when mapping it, the
  acceptance check), the build order, styling the diff viewer with tokens, and how to verify
  (`ui:gaps`, a build, a side-by-side with the reference).
- **`pnpm ui:check` in CI:** no design-system import outside adapters; manifest and catalogue match
  the code; every contract component has a prompt section and a conformance entry in the reference
  adapter; every feature references things that exist. Adding a feature or a contract component
  without its documentation fails CI.
- Screenshots are generated locally (`pxsig dashboard screenshots`), never committed (the repository
  forbids images).
- `docs/ui/` ships in the npm package, so a consumer's agent reads it from
  `node_modules/pxsig/docs/ui/`.

## Private reference material

A real design system pxsig will run on informs the contract (which components such a library has,
typical gaps, naming conventions). It is read only to write neutral capability notes; nothing from
it (names, code, mappings) is committed here. Notes and any reference map live in `.local/`
(git-ignored; `check-clean` fails if anything under it is ever tracked); the maintainer's
denylist (`/scrub`) covers that library's names. That design system's adapter is written by the
maintainer in their own environment.

## Phases

| Phase | Delivers                                                                                                                            | Proven by                                                                                                                    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1     | Contract, `@ui`, hydrotik adapter, build-time switch, generated manifest, conformance, `ui:gaps`                                    | views free of design-system imports; reference renders identically (section × theme screenshots); unknown adapter fails fast |
| 2     | Diff-viewer primitives; the inspector rebuilt on them                                                                               | the inspector renders identically; primitive tests (keyboard, ARIA, controlled state)                                        |
| 3     | Shipping the source in `pxsig`, `pxsig dashboard build` / `gaps` for consumers, a deliberately plain example adapter in `examples/` | the plain adapter builds from an installed `pxsig` and reports its gaps                                                      |
| 4     | Feature registry, generated catalogue, build prompt, `ui:check` in CI                                                               | removing a documented feature or adding an undocumented component fails CI                                                   |

Later, if wanted: pulling the views' logic into headless hooks so a team could replace whole
views, not only components.

Starts after the Navbar dashboard (in review) is merged, since it reshapes the shell.

## For sign-off

1. The four parts and phasing above.
2. No extraction or publishing of `@hydrotik/design-system`; the dashboard's source ships in `pxsig`.
3. Neutral contract names (final list after the import inventory).
4. Deep headless hooks deferred.
5. `.local/` for private notes and the reference map, never committed.

## Implementation notes

- **Final component names** (from the import inventory): `StatGroup` (the plan's `StatCard`: a row
  of figures), `StatusBadge` (tone, icon, label; the verdict table is the dashboard's
  `parts/StatusOf.tsx`, rule 2), `AppShell` and `AppMain` (the frame), `NavList`, `KeyValueList` /
  `KeyValueItem`, `ToolbarStart` / `ToolbarEnd` / `ToolbarField` / `ToolbarSummary`, `AlertTitle` /
  `AlertDescription`, `DialogTitle` / `DialogDescription`, and one `Chart`. `PageHeader`,
  `SidePanel`, `Menu` and `Tooltip` are not in the contract: nothing in the dashboard renders them
  (the tooltip provider lives in the adapter's `UiProvider`). 42 components, 17 required.
- **`Heatmap`** (added after phase 4): an optional chart, tiles coloured by a share on one
  sequential scale in five steps, for stale entries by component. 43 components, 17 required.
- **Diff viewer:** besides the parts the plan names, `Pane` (one view; side by side has two),
  `Frame` (the moved and scaled image box) and `SwipeHandle`.
- **Tokens:** the reference adapter maps `motion.fast` to a literal 120ms (the design system's
  fastest duration is 100ms) so nothing renders differently.
- **Serving a rebuilt dashboard:** `PXSIG_DASHBOARD_DIR`; `pxsig serve` and `pxsig report` are
  otherwise unchanged.

- **Contract version** (added after phase 4): `CONTRACT_VERSION` (1.0.0) in `contract.ts`, held to
  `src/ui/contract-lock.json` by `pnpm ui:check`; adapters record theirs in `conformance.json`;
  new tokens and icons can carry defaults (`TOKEN_DEFAULTS`, `ICON_DEFAULTS`) so adding one is a
  minor change. See [ui/contract-changes.md](ui/contract-changes.md).
