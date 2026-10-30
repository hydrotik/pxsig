/**
 * The contract's component props (contract.ts re-exports every one): what each component the
 * dashboard renders from a design system receives, in the order of contract.ts's groups.
 */
import type * as React from 'react';
import type { Emphasis, IconName, Size, ThemeMode, Tone } from '../contract';

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
/**
 * A short hint on hover of the element it wraps (since 1.1.0). `content` is plain text that only
 * repeats what the page shows elsewhere, so a hover-only hint loses nothing. The fallback puts it in
 * the element's native `title`.
 */
export interface TooltipProps {
  /** The hint's text. */
  content: string;
  /** The one element it describes; it must accept a ref and DOM props. */
  children: React.ReactElement;
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
/** An alert's title line: emphasised text, not a heading (an alert sits anywhere in the outline). */
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

/** One tile of a `Heatmap`. */
export interface HeatmapCell {
  id: string;
  /** What the tile stands for (a component name). Visible on the tile. */
  label: string;
  /** The share the tile's colour encodes, 0–1. */
  value: number;
  /** The figure behind the share, visible on the tile ("3 stale of 10"), so colour is never the only cue. */
  text: string;
  /** The tile's accessible name. Unset: the label and the text. */
  accessibleLabel?: string;
}
/**
 * A grid of tiles, each coloured by its share on one sequential scale (one hue, light to dark) in
 * five equal steps: (0, 0.2], (0.2, 0.4], … (0.8, 1]; a share of 0 is the plain surface. Tiles keep
 * the order given. A legend shows the steps; the text on a tile meets contrast on every step.
 */
export interface HeatmapProps extends WithClass {
  /** Accessible name of the grid. */
  label: string;
  cells: HeatmapCell[];
  /** The legend: what the scale measures, and the labels of its first and last step. */
  legend: { label: string; low: string; high: string };
  /** Makes each tile a button. */
  onSelect?: (cell: HeatmapCell) => void;
}
