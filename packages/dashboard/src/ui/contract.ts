/**
 * The UI contract: every component the dashboard renders from a design system, with the props and
 * semantics each one must honour. Views import these names from `@ui` only; an adapter
 * (`src/ui/adapters/<name>/`, or a module named by `dashboard.ui` in pxsig.config.json) implements
 * them on a real design system, selected once at build time.
 *
 * Rules (docs/ui/build-adapter.md explains each, with the questions to answer when mapping):
 *  1. Emphasis and tone are separate props: `emphasis` (solid | outline | ghost | subtle) and one tone
 *     vocabulary everywhere (`Tone`).
 *  2. The dashboard owns its domain vocabulary (verdicts, coverage codes): it passes an adapter a
 *     tone, an icon and a label, never a verdict.
 *  3. Size is a hint (`sm` | `md`); density is set once, by the adapter's provider. A control in a
 *     `Toolbar` with no `size` takes the toolbar's.
 *  4. Compound parts are prefixed exports (`Card`, `CardHeader`, …), never dot notation; an adapter
 *     may collapse them into props of one component internally.
 *  5. Value-style callbacks (`onValueChange(value)`), controlled inputs, and data-driven choice
 *     components (`options`, `value`, `onValueChange`) rather than trigger / content parts.
 *  6. The data table takes a neutral column definition (`DataColumn`): no grid library's types.
 *  7. Theme mode belongs to the contract runtime (`useThemeMode()`); the adapter's provider
 *     receives it and never owns the setter.
 *  8. Icons are a closed union of names (`IconName`); each adapter supplies the glyphs.
 *  9. Charts are high-level components (`Chart`, `Heatmap`); an adapter whose design system has no
 *     charts brings its own or leaves them to the fallback.
 * 10. Every token group is required in the token map (`TokenMap`, ./tokens.ts); a design system
 *     without one maps it to literal values.
 * 11. Links take a `render` prop for router integration.
 *
 * Every component accepts `className` where the dashboard positions it; an adapter forwards it to
 * the component's root element. Props not listed here are never passed.
 */
import type * as React from 'react';
import type { TokenMap } from './tokens';
import type { UiProviderProps, AppShellProps, AppMainProps, TopNavProps, NavListProps, NavLinkProps, NavEndProps, ButtonProps, IconButtonProps, CardProps, CardHeaderProps, CardTitleProps, CardDescriptionProps, CardContentProps, StatGroupProps, DataTableProps, StatusBadgeProps, BadgeProps, IconProps, DialogProps, DialogTitleProps, DialogDescriptionProps, SliderProps, SwitchProps, SegmentedChoiceProps, ToolbarProps, ToolbarStartProps, ToolbarEndProps, ToolbarFieldProps, ToolbarSummaryProps, CopyValueProps, KbdProps, TooltipProps, LinkProps, ProgressProps, KeyValueListProps, KeyValueItemProps, AlertProps, AlertTitleProps, AlertDescriptionProps, SearchFieldProps, SelectProps, ChartProps, HeatmapProps } from './contract/props';

export type { TokenMap, TokenName } from './tokens';

/**
 * The contract's version, separate from pxsig's (docs/ui/contract-changes.md lists each one). Minor:
 * a new optional component or prop with a fallback, a new token or icon with a default. Major: a
 * component or prop removed or changed in meaning, a new required component, a token or icon without
 * a default. An adapter records the version it was written for in its conformance.json
 * (`"contract"`); `pnpm ui:check` holds this number to src/ui/contract-lock.json.
 */
export const CONTRACT_VERSION = '1.1.0';

// --- shared vocabulary ---------------------------------------------------------------------------

/** One tone vocabulary for every component that colours by state. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
/** How loud a control or badge is, independent of its tone. */
export type Emphasis = 'solid' | 'outline' | 'ghost' | 'subtle';
/** A size hint. `md` is the default; an adapter maps both to its own scale. */
export type Size = 'sm' | 'md';
/** Light or dark: owned by the runtime (`useThemeMode`), passed to the adapter's provider. */
export type ThemeMode = 'light' | 'dark';

/** Every glyph the dashboard draws. An adapter maps each name to an icon of its own set. */
export const ICON_NAMES = [
  'check', // a circle with a check: passed, approved
  'alert', // a warning triangle: needs review
  'dot', // a filled dot in a circle: new, or a status with no glyph of its own
  'ban', // a circle with a slash: rejected
  'pause', // flaky
  'dashed', // a dashed circle: not run
  'cross', // a circle with a cross: failed
  'sun', // theme toggle: to light
  'moon', // theme toggle: to dark
  'arrow-down-left', // a card filters the view it is on
  'arrow-up-right', // a card goes somewhere else
  'external', // a link that opens a new tab
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/**
 * Icons added after 1.0.0: the contract version that added each, and the icon an adapter written
 * for an older version draws instead (the runtime substitutes it), so adding an icon is a minor
 * change. Empty: every icon is from 1.0.0.
 */
export const ICON_DEFAULTS = {} as const satisfies Partial<Record<IconName, { since: string; draw: IconName }>>;

// --- component props (contract/props.ts) ---------------------------------------------------------

export type { UiProviderProps, AppShellProps, AppMainProps, TopNavProps, NavListProps, NavLinkProps, NavEndProps, ButtonProps, IconButtonProps, CardProps, CardHeaderProps, CardTitleProps, CardDescriptionProps, CardContentProps, StatItem, StatGroupProps, DataColumn, DataTableProps, StatusBadgeProps, BadgeProps, IconProps, DialogProps, DialogTitleProps, DialogDescriptionProps, SliderProps, SwitchProps, ChoiceOption, SegmentedChoiceProps, ToolbarProps, ToolbarStartProps, ToolbarEndProps, ToolbarFieldProps, ToolbarSummaryProps, CopyValueProps, KbdProps, TooltipProps, LinkProps, ProgressProps, KeyValueListProps, KeyValueItemProps, AlertProps, AlertTitleProps, AlertDescriptionProps, SearchFieldProps, SelectOption, SelectProps, SeriesDef, ChartProps, HeatmapCell, HeatmapProps } from './contract/props';

/** The step (0–5) a share falls in on a `Heatmap`'s scale: 0 only for a share of 0. */
export const heatStep = (value: number): 0 | 1 | 2 | 3 | 4 | 5 => (value <= 0 ? 0 : (Math.min(5, Math.max(1, Math.ceil(value * 5))) as 1 | 2 | 3 | 4 | 5));

// --- the contract as data ------------------------------------------------------------------------

export type Group = 'shell' | 'core' | 'controls' | 'charts';

/** Every contract component: its group, whether an adapter must supply it, and its role. */
export const CONTRACT = {
  UiProvider: { group: 'shell', required: false, role: 'theme mode, density, fonts and context for the components' },
  AppShell: { group: 'shell', required: false, role: 'the page frame: top bar above a scrolling main region' },
  AppMain: { group: 'shell', required: false, role: 'the main region, the scroll container' },
  TopNav: { group: 'shell', required: true, role: 'the top bar: mark, section links, pinned controls' },
  NavList: { group: 'shell', required: true, role: 'the section links, with overflow' },
  NavLink: { group: 'shell', required: true, role: 'one section link with an optional count' },
  NavEnd: { group: 'shell', required: false, role: 'the controls pinned at the end of the top bar' },
  Button: { group: 'core', required: true, role: 'a command, or a link styled as one' },
  IconButton: { group: 'core', required: true, role: 'a square button with a glyph' },
  Card: { group: 'core', required: true, role: 'a titled region' },
  CardHeader: { group: 'core', required: true, role: "a card's header" },
  CardTitle: { group: 'core', required: true, role: "a card's heading" },
  CardDescription: { group: 'core', required: true, role: "a card's description" },
  CardContent: { group: 'core', required: true, role: "a card's body" },
  StatGroup: { group: 'core', required: false, role: 'a row of key figures, some selectable' },
  DataTable: { group: 'core', required: false, role: 'records as sortable rows' },
  StatusBadge: { group: 'core', required: true, role: 'a state: tone, icon and label' },
  Badge: { group: 'core', required: true, role: 'a short tag' },
  Icon: { group: 'core', required: true, role: 'a glyph from the closed set' },
  Dialog: { group: 'controls', required: true, role: 'a modal dialog (the inspector)' },
  DialogTitle: { group: 'controls', required: true, role: "the dialog's accessible name" },
  DialogDescription: { group: 'controls', required: true, role: "the dialog's description" },
  Slider: { group: 'controls', required: false, role: 'one number on a range' },
  Switch: { group: 'controls', required: false, role: 'an on / off control' },
  SegmentedChoice: { group: 'controls', required: false, role: 'one of a few visible options' },
  Toolbar: { group: 'controls', required: false, role: 'a row of controls of one size' },
  ToolbarStart: { group: 'controls', required: false, role: "a toolbar's leading group" },
  ToolbarEnd: { group: 'controls', required: false, role: "a toolbar's trailing group" },
  ToolbarField: { group: 'controls', required: false, role: 'a labelled control in a toolbar' },
  ToolbarSummary: { group: 'controls', required: false, role: "a count on the toolbar's line" },
  CopyValue: { group: 'controls', required: false, role: 'a command with a copy button' },
  Kbd: { group: 'controls', required: false, role: 'a keyboard key' },
  Tooltip: { group: 'controls', required: false, role: 'a short hint on hover of one element' },
  Link: { group: 'controls', required: false, role: 'a link, router-aware through render' },
  Progress: { group: 'controls', required: false, role: 'a completion bar' },
  KeyValueList: { group: 'controls', required: false, role: 'label → value pairs' },
  KeyValueItem: { group: 'controls', required: false, role: 'one label → value pair' },
  Alert: { group: 'controls', required: false, role: 'a message about the whole page' },
  AlertTitle: { group: 'controls', required: false, role: "an alert's title line, not a heading" },
  AlertDescription: { group: 'controls', required: false, role: "an alert's body" },
  SearchField: { group: 'controls', required: false, role: 'a controlled search input' },
  Select: { group: 'controls', required: true, role: 'one value from a list' },
  Chart: { group: 'charts', required: false, role: 'bar or line chart' },
  Heatmap: { group: 'charts', required: false, role: 'tiles coloured by a share on one sequential scale' },
} as const satisfies Record<string, { group: Group; required: boolean; role: string }>;

export type ComponentName = keyof typeof CONTRACT;
export const COMPONENT_NAMES = Object.keys(CONTRACT) as ComponentName[];

/** The props of each contract component, by name. */
export interface ComponentProps {
  UiProvider: UiProviderProps;
  AppShell: AppShellProps;
  AppMain: AppMainProps;
  TopNav: TopNavProps;
  NavList: NavListProps;
  NavLink: NavLinkProps;
  NavEnd: NavEndProps;
  Button: ButtonProps;
  IconButton: IconButtonProps;
  Card: CardProps;
  CardHeader: CardHeaderProps;
  CardTitle: CardTitleProps;
  CardDescription: CardDescriptionProps;
  CardContent: CardContentProps;
  StatGroup: StatGroupProps;
  DataTable: DataTableProps<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  StatusBadge: StatusBadgeProps;
  Badge: BadgeProps;
  Icon: IconProps;
  Dialog: DialogProps;
  DialogTitle: DialogTitleProps;
  DialogDescription: DialogDescriptionProps;
  Slider: SliderProps;
  Switch: SwitchProps;
  SegmentedChoice: SegmentedChoiceProps;
  Toolbar: ToolbarProps;
  ToolbarStart: ToolbarStartProps;
  ToolbarEnd: ToolbarEndProps;
  ToolbarField: ToolbarFieldProps;
  ToolbarSummary: ToolbarSummaryProps;
  CopyValue: CopyValueProps;
  Kbd: KbdProps;
  Tooltip: TooltipProps;
  Link: LinkProps;
  Progress: ProgressProps;
  KeyValueList: KeyValueListProps;
  KeyValueItem: KeyValueItemProps;
  Alert: AlertProps;
  AlertTitle: AlertTitleProps;
  AlertDescription: AlertDescriptionProps;
  SearchField: SearchFieldProps;
  Select: SelectProps;
  Chart: ChartProps;
  Heatmap: HeatmapProps;
}

type Required_ = { [K in ComponentName]: (typeof CONTRACT)[K]['required'] extends true ? K : never }[ComponentName];
type Optional_ = Exclude<ComponentName, Required_>;

/**
 * What an adapter module exports: `name`, `tokens` (a value for every `TokenName`) and the
 * components, each a React component taking the contract's props. Required components must be
 * present; an optional one the adapter lacks falls back to a plain rendering (ui/fallbacks.tsx).
 */
export type UiAdapter = { name: string; tokens: TokenMap } & { [K in Required_]: React.ComponentType<ComponentProps[K]> } & {
  [K in Optional_]?: React.ComponentType<ComponentProps[K]>;
};

/** A conformance entry: how fully the adapter covers one contract component. */
export type Conformance = 'full' | 'partial' | 'bespoke' | 'missing';
