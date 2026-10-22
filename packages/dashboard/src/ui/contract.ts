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
 *  9. Charts are one high-level component (`Chart`); an adapter whose design system has no charts
 *     brings its own or leaves it to the fallback.
 * 10. Every token group is required in the token map (`TokenMap`, ./tokens.ts); a design system
 *     without one maps it to literal values.
 * 11. Links take a `render` prop for router integration.
 *
 * Every component accepts `className` where the dashboard positions it; an adapter forwards it to
 * the component's root element. Props not listed here are never passed.
 */
import type * as React from 'react';
import type { TokenMap } from './tokens';

export type { TokenMap, TokenName } from './tokens';

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

interface WithClass {
  className?: string;
}

// --- shell ---------------------------------------------------------------------------------------

/** The adapter's root: theme mode, density, fonts, any context its components need (tooltips…). */
export interface UiProviderProps {
  mode: ThemeMode;
  children: React.ReactNode;
}
/** The page frame: the top bar, then the scrolling main region. Fills the viewport. */
export interface AppShellProps {
  children: React.ReactNode;
}
/** The main region: a `<main>` element, the page's scroll container. */
export interface AppMainProps {
  ref?: React.Ref<HTMLElement>;
  children: React.ReactNode;
}
/** The top bar: the report's mark, the section links, then the controls pinned at the end. */
export interface TopNavProps extends WithClass {
  /** Accessible name of the navigation landmark. */
  label: string;
  /** The mark at the start: a heading and a tag. */
  brand: React.ReactNode;
  /** A `NavList`, then a `NavEnd`. */
  children: React.ReactNode;
}
/** The section links. Links that do not fit move into an overflow menu when the adapter has one. */
export interface NavListProps {
  children: React.ReactNode;
}
/** One section link: a plain `#<id>` link, marked current with `aria-current="page"`. */
export interface NavLinkProps {
  href: string;
  active: boolean;
  /** A count after the label. Not shown at zero. */
  count?: number;
  /** `info`: asks for action (accent); `neutral`: a plain total. */
  countTone?: 'info' | 'neutral';
  /** The link's accessible name with its count ("Review Stories, 6 to review"). */
  countLabel?: string;
  children: React.ReactNode;
}
/** The controls pinned at the end of the top bar. */
export interface NavEndProps extends WithClass {
  children: React.ReactNode;
}

// --- core ----------------------------------------------------------------------------------------

/** A command. With `href` it is a link that looks like a button (opens a new tab when `external`). */
export interface ButtonProps {
  /** `solid` (default): the primary action; `outline`: secondary; `ghost`: tertiary. */
  emphasis?: Exclude<Emphasis, 'subtle'>;
  /** Unset: `md`, or the surrounding toolbar's size. */
  size?: Size;
  disabled?: boolean;
  title?: string;
  'aria-label'?: string;
  onClick?: (event: React.MouseEvent) => void;
  href?: string;
  external?: boolean;
  children: React.ReactNode;
}
/** A square button holding a glyph or one character. `label` is its accessible name. */
export interface IconButtonProps {
  label: string;
  /** A tooltip. Unset: none. */
  title?: string;
  emphasis?: Exclude<Emphasis, 'subtle' | 'solid'>;
  /** Unset: the surrounding toolbar's size, else `md`. */
  size?: Size;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}
/** A titled region of a page. */
export interface CardProps {
  children: React.ReactNode;
}
export interface CardHeaderProps {
  children: React.ReactNode;
}
/** The card's heading. */
export interface CardTitleProps {
  children: React.ReactNode;
}
export interface CardDescriptionProps extends WithClass {
  children: React.ReactNode;
}
export interface CardContentProps {
  children: React.ReactNode;
}
/** One figure in a `StatGroup`. */
export interface StatItem {
  label: string;
  value: React.ReactNode;
  /** Set smaller after the value. */
  unit?: React.ReactNode;
  /** Colours the item by state. Unset: normal. */
  tone?: Tone;
  /** Makes the item a button (a filter on the view, or a way somewhere else). */
  onSelect?: () => void;
  /** A filter item: whether its filter is on (`aria-pressed`). */
  active?: boolean;
  /** A glyph in the item's corner saying what selecting it does. Decorative. */
  icon?: React.ReactNode;
}
/** A row of key figures. */
export interface StatGroupProps extends WithClass {
  label: string;
  items: StatItem[];
  /** `cards` (default): separate tiles; `strip`: one band, inside a card. */
  layout?: 'cards' | 'strip';
}
/** A column of a `DataTable`. */
export interface DataColumn<T> {
  id: string;
  header: string;
  /** The record field the column shows and sorts by. A column without one is display only. */
  field?: keyof T & string;
  /** Renders the cell. Unset: the field's value as text. */
  cell?: (row: T) => React.ReactNode;
  align?: 'start' | 'end';
  /** A CSS width. Unset: the adapter's layout. */
  width?: string;
}
/** Records as rows. Sortable by the columns with a `field`. */
export interface DataTableProps<T> {
  rows: T[];
  rowId: (row: T) => string;
  columns: DataColumn<T>[];
  /** Makes rows activatable (pointer and keyboard). */
  onRowClick?: (row: T) => void;
  /** A search field and column chooser above the table. Default off. */
  search?: boolean;
  /** `false`: every row on one page. Unset: the adapter's paging. */
  paginate?: boolean;
}
/** A state as an icon plus a label; the label is always visible, so colour is never the only signal. */
export interface StatusBadgeProps extends WithClass {
  tone: Tone;
  icon: IconName;
  label: string;
  title?: string;
}
/** A short tag. Not a count of something to do (that is `NavLink`'s count). */
export interface BadgeProps extends WithClass {
  tone?: Tone;
  /** `subtle` (default): a wash; `outline`: a border; `solid`: filled. */
  emphasis?: Exclude<Emphasis, 'ghost'>;
  /** A live indicator: a pulsing dot. */
  pulse?: boolean;
  title?: string;
  children: React.ReactNode;
}
/** A glyph from the closed set. Always decorative (`aria-hidden`): the text beside it says it. */
export interface IconProps extends WithClass {
  name: IconName;
  /** A CSS size. Unset: the adapter's default. */
  size?: string;
}

// --- controls ------------------------------------------------------------------------------------

/** A modal dialog. Esc and the backdrop close it through `onOpenChange(false)`. */
export interface DialogProps extends WithClass {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element focused on open (instead of the first control), without showing a focus ring. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}
/** The dialog's accessible name. Focusable by script when `tabIndex={-1}`. */
export interface DialogTitleProps extends WithClass {
  tabIndex?: number;
  ref?: React.Ref<HTMLHeadingElement>;
  children: React.ReactNode;
}
export interface DialogDescriptionProps extends WithClass {
  style?: React.CSSProperties;
  children: React.ReactNode;
}
/** One number on a range, with its label and value shown. */
export interface SliderProps extends WithClass {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max: number;
  step?: number;
  /** Unset: the number as is. */
  formatValue?: (value: number) => string;
}
/** An on / off control. The visible text sits beside it, in the caller's `<label>`. */
export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}
/** One option of a `SegmentedChoice`. */
export interface ChoiceOption {
  value: string;
  label: React.ReactNode;
  /** Accessible name when `label` is short or symbolic. */
  accessibleLabel?: string;
  title?: string;
}
/** Exactly one of a few options, all visible. Never calls back with nothing selected. */
export interface SegmentedChoiceProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ChoiceOption[];
}
/** A row of controls sharing one size and one line. */
export interface ToolbarProps extends WithClass {
  size?: Size;
  children: React.ReactNode;
}
export interface ToolbarStartProps {
  children: React.ReactNode;
}
export interface ToolbarEndProps {
  children: React.ReactNode;
}
/**
 * A labelled control in a toolbar: labels share a top edge, controls a bottom edge. The label names
 * its one child: an adapter may pass the child an `id` (Select and SearchField accept one).
 */
export interface ToolbarFieldProps {
  label: string;
  minInlineSize?: string;
  grow?: boolean;
  /** The one control the label names (it may receive an `id`). */
  children: React.ReactElement<{ id?: string }>;
}
/** A count or note on the toolbar's control line ("1,024 of 1,024"). */
export interface ToolbarSummaryProps {
  /** Announced politely when it changes. */
  live?: boolean;
  children: React.ReactNode;
}
/** A value (a command) shown as code with a copy button. */
export interface CopyValueProps {
  value: string;
}
/** A key on the keyboard. */
export interface KbdProps {
  children: React.ReactNode;
}
/** A link. `render` integrates a router: it receives the anchor props and returns the element. */
export interface LinkProps extends WithClass {
  href: string;
  /** Opens in a new tab, marked as such. */
  external?: boolean;
  title?: string;
  render?: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.ReactElement;
  children: React.ReactNode;
}
/** A completion bar, 0–100. */
export interface ProgressProps extends WithClass {
  value: number;
  /** Accessible name; also shown, with the percentage, when `showLabel`. */
  label: string;
  showLabel?: boolean;
}
/** Label → value pairs. */
export interface KeyValueListProps {
  orientation?: 'vertical' | 'horizontal';
  /** The label column's width (vertical). */
  labelWidth?: string;
  children: React.ReactNode;
}
export interface KeyValueItemProps {
  label: string;
  children: React.ReactNode;
}
/** A message about the whole page. */
export interface AlertProps {
  tone: 'neutral' | 'danger';
  /** Accessible name of the region. */
  label: string;
  children: React.ReactNode;
}
export interface AlertTitleProps {
  children: React.ReactNode;
}
export interface AlertDescriptionProps {
  children: React.ReactNode;
}
/** A controlled search input. */
export interface SearchFieldProps {
  /** Set by a ToolbarField that labels the input. */
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}
/** One option of a `Select`. */
export interface SelectOption {
  value: string;
  label: string;
}
/** One value from a list that does not fit as a segmented choice. */
export interface SelectProps {
  /** Set by a ToolbarField that labels the control: put it on the focusable trigger. */
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  /** Accessible name when no `ToolbarField` labels it. */
  label?: string;
  size?: Size;
  /** A CSS width for the trigger. */
  inlineSize?: string;
}

// --- charts --------------------------------------------------------------------------------------

/** A data series: the record key holding its values, and its legend label. */
export interface SeriesDef {
  key: string;
  label: string;
}
/**
 * One chart. `bar`: horizontal grouped bars, one row per category (`x` names the category key);
 * `line`: lines over an ordered x. Series take the adapter's categorical colours in order. A legend
 * shows when there is more than one series; a tooltip on hover.
 */
export interface ChartProps extends WithClass {
  kind: 'bar' | 'line';
  data: Record<string, unknown>[];
  series: SeriesDef[];
  x: string;
  /** Formats the value axis and tooltip. */
  format?: (value: number) => string;
  /** The value axis maximum (bars). Unset: from the data. */
  max?: number;
  /** A CSS block size. */
  height: string;
}

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
  Link: { group: 'controls', required: false, role: 'a link, router-aware through render' },
  Progress: { group: 'controls', required: false, role: 'a completion bar' },
  KeyValueList: { group: 'controls', required: false, role: 'label → value pairs' },
  KeyValueItem: { group: 'controls', required: false, role: 'one label → value pair' },
  Alert: { group: 'controls', required: false, role: 'a message about the whole page' },
  AlertTitle: { group: 'controls', required: false, role: "an alert's heading" },
  AlertDescription: { group: 'controls', required: false, role: "an alert's body" },
  SearchField: { group: 'controls', required: false, role: 'a controlled search input' },
  Select: { group: 'controls', required: true, role: 'one value from a list' },
  Chart: { group: 'charts', required: false, role: 'bar or line chart' },
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
