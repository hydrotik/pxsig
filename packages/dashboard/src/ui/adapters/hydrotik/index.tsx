/**
 * The reference adapter: the UI contract on @hydrotik/design-system (the dashboard's look since
 * 0.1). Each component maps the contract's neutral props onto the design system's own, and
 * renders exactly what the views rendered before the contract existed.
 */
import React from 'react';
import '@hydrotik/design-system/fonts';
import './base.css';
import * as DS from '@hydrotik/design-system';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@hydrotik/design-system/chart';
import { focusColor } from '@hydrotik/design-system/styles';
import { ThemeProvider } from '@hydrotik/theme-provider';
import { vars } from '@hydrotik/tokens';
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  XAxis,
  YAxis,
} from 'recharts';
import type * as C from '../../contract';
import { alertParts } from './alert';
import { type ChartA11y, withChartSummary } from './chart-a11y';
import { sidePanel } from './side-panel';
import { textField } from './text-field';
import { toneBadge, toneStatGroup } from './tones';
export { Heatmap } from './heatmap';

export const name = 'hydrotik';

// --- tokens: the neutral names onto the design system's variables --------------------------------
export const tokens: C.TokenMap = {
  'color.background': vars.color.background,
  'color.surface': vars.color.surface,
  'color.surfaceRaised': vars.color.surfaceElevated,
  'color.border': vars.color.border,
  'color.text': vars.color.text,
  'color.textMuted': vars.color.textMuted,
  'color.accent': vars.color.primary,
  'color.focus': focusColor,
  'color.hover': vars.color.ghostHover,
  'color.success': vars.color.success,
  'color.warning': vars.color.warning,
  'color.danger': vars.color.destructive,
  'space.0_5': vars.space['0_5'],
  'space.1': vars.space['1'],
  'space.1_5': vars.space['1_5'],
  'space.2': vars.space['2'],
  'space.2_5': vars.space['2_5'],
  'space.3': vars.space['3'],
  'space.4': vars.space['4'],
  'space.5': vars.space['5'],
  'space.6': vars.space['6'],
  'space.8': vars.space['8'],
  'space.12': vars.space['12'],
  'radius.sm': vars.radii.sm,
  'radius.md': vars.radii.md,
  'radius.lg': vars.radii.lg,
  'font.sans': vars.font.family.sans,
  'font.mono': vars.font.family.mono,
  'fontSize.3xs': vars.font.size['3xs'],
  'fontSize.2xs': vars.font.size['2xs'],
  'fontSize.xs': vars.font.size.xs,
  'fontSize.sm': vars.font.size.sm,
  'fontSize.lg': vars.font.size.lg,
  'fontWeight.semibold': vars.font.weight.semibold,
  'lineHeight.relaxed': vars.font.lineHeight.relaxed,
  'letterSpacing.caps': vars.font.letterSpacing.caps,
  'line.emphasis': vars.stroke.accent,
  'motion.fast': vars.motion.duration.fast,
};

// --- shell ---------------------------------------------------------------------------------------

/**
 * The design system's theme provider, controlled by the runtime's mode (contract rule 7): it puts
 * the theme on <html> before its children first render and follows `mode`, never storage.
 */
export const UiProvider = ({ mode, children }: C.UiProviderProps) => (
  <ThemeProvider theme={mode} storageKey="pxsig-dashboard-theme">
    <DS.TooltipProvider>{children}</DS.TooltipProvider>
  </ThemeProvider>
);

export const AppShell = ({ children }: C.AppShellProps) => <DS.AppShell>{children}</DS.AppShell>;

export const AppMain = ({ ref, children }: C.AppMainProps) => (
  <DS.AppShellContent asChild>
    <main ref={ref}>{children}</main>
  </DS.AppShellContent>
);

export const TopNav = ({ label, brand, className, children }: C.TopNavProps) => (
  <DS.Navbar aria-label={label} className={className} logo={brand}>
    {children}
  </DS.Navbar>
);

const navItemProps = ({ href, active, count, countTone, countLabel }: C.NavLinkProps) => ({
  href,
  active,
  count,
  // `info` asks for action: the design system's attention count, subtle (primary digits on the
  // neutral count's wash), in the bar and in More.
  countTone:
    countTone === undefined
      ? undefined
      : countTone === 'info'
        ? ('attention' as const)
        : ('neutral' as const),
  countEmphasis: countTone === 'info' ? ('subtle' as const) : undefined,
  // A count over 99 shows as "99+": the name says so too, so it contains what is on screen.
  countLabel: count !== undefined && count > 99 ? `99+, ${countLabel ?? count}` : countLabel,
});

export const NavLink = (p: C.NavLinkProps) => (
  <DS.NavItemLink {...navItemProps(p)}>{p.children}</DS.NavItemLink>
);

/**
 * The design system's NavItems finds its links by element type (to measure them and move the ones
 * that do not fit into its More menu), so each contract NavLink becomes a NavItemLink here; a kept
 * one never moves (`keep`). `moreLabel` names the More trigger and its menu.
 */
export const NavList = ({ moreLabel, children }: C.NavListProps) => (
  <DS.NavItems moreLabel={moreLabel}>
    {React.Children.map(children, (c) => {
      if (!React.isValidElement<C.NavLinkProps>(c) || c.type !== NavLink) return c;
      return (
        <DS.NavItemLink key={c.key ?? undefined} {...navItemProps(c.props)} keep={c.props.keep}>
          {c.props.children}
        </DS.NavItemLink>
      );
    })}
  </DS.NavItems>
);

export const NavEnd = ({ className, children }: C.NavEndProps) => (
  <div className={className}>{children}</div>
);

// --- core ----------------------------------------------------------------------------------------

const VARIANT = { solid: 'default', outline: 'outline', ghost: 'ghost' } as const;

export function Button({
  emphasis = 'solid',
  size,
  href,
  external,
  children,
  ...rest
}: C.ButtonProps) {
  const variant = VARIANT[emphasis];
  if (href)
    return (
      <DS.Button asChild size={size} variant={variant}>
        <a
          href={href}
          {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
          title={rest.title}
          aria-label={rest['aria-label']}
        >
          {children}
        </a>
      </DS.Button>
    );
  return (
    <DS.Button size={size} variant={variant === 'default' ? undefined : variant} {...rest}>
      {children}
    </DS.Button>
  );
}

export const IconButton = ({
  label,
  title,
  emphasis = 'outline',
  size,
  disabled,
  onClick,
  children,
}: C.IconButtonProps) => (
  <DS.Button
    size={size === 'sm' ? 'icon-sm' : 'icon'}
    variant={emphasis}
    aria-label={label}
    title={title}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </DS.Button>
);

export const Card = ({ children }: C.CardProps) => <DS.Card>{children}</DS.Card>;
export const CardHeader = ({ children }: C.CardHeaderProps) => (
  <DS.CardHeader>{children}</DS.CardHeader>
);
export const CardTitle = ({ children }: C.CardTitleProps) => (
  <DS.CardTitle>{children}</DS.CardTitle>
);
export const CardDescription = ({ mono, className, children }: C.CardDescriptionProps) => (
  <DS.CardDescription mono={mono} className={className}>
    {children}
  </DS.CardDescription>
);
export const CardContent = ({ children }: C.CardContentProps) => (
  <DS.CardContent>{children}</DS.CardContent>
);

export const StatGroup = toneStatGroup(DS.StatPanel);

export function DataTable<T>(props: C.DataTableProps<T>) {
  return <Grid {...props} />;
}

function Grid<T>({ rows, rowId, columns, onRowClick, search, paginate }: C.DataTableProps<T>) {
  return (
    <DS.DataGrid
      data={rows}
      getRowId={rowId}
      density="compact"
      showToolbar={!!search}
      {...(paginate === false ? { enablePagination: false } : {})}
      {...(onRowClick ? { onRowClick: (row: { original: T }) => onRowClick(row.original) } : {})}
      columns={columns.map((c) => ({
        id: c.id,
        ...(c.field ? { accessorKey: c.field } : {}),
        header: c.header,
        ...(c.align === 'end' ? { align: 'right' as const } : {}),
        // The grid sizes columns in pixels: a px width maps; any other CSS width is left to the grid.
        ...(c.width?.endsWith('px') ? { size: parseFloat(c.width) } : {}),
        ...(c.cell ? { cell: ({ row }: { row: { original: T } }) => c.cell!(row.original) } : {}),
      }))}
    />
  );
}

/** Each icon name → a lucide glyph (the design system's icon set). */
const GLYPH: Record<
  C.IconName,
  React.ComponentType<{
    'aria-hidden'?: boolean | 'true';
    className?: string;
    size?: string | number;
  }>
> = {
  check: DS.Icons.CircleCheck,
  alert: DS.Icons.TriangleAlert,
  dot: DS.Icons.CircleDot,
  ban: DS.Icons.Ban,
  pause: DS.Icons.Pause,
  dashed: DS.Icons.CircleDashed,
  cross: DS.Icons.CircleX,
  sun: DS.Icons.Sun,
  moon: DS.Icons.Moon,
  'arrow-down-left': DS.Icons.ArrowDownLeft,
  'arrow-up-right': DS.Icons.ArrowUpRight,
  external: DS.Icons.ExternalLink,
};

const STATUS_TONE: Record<C.Tone, 'neutral' | 'info' | 'success' | 'warning' | 'error'> = {
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'error',
};

export const StatusBadge = ({ tone, icon, label, title, className }: C.StatusBadgeProps) => (
  <DS.StatusBadge
    label={label}
    tone={STATUS_TONE[tone]}
    icon={GLYPH[icon] as never}
    title={title}
    className={className}
  />
);

export const Badge = toneBadge(DS.Badge);

// The design system's size for an icon in a control: 14px in a 28px icon button, at lucide's
// stroke. Without it lucide draws 24px, which nearly fills the button and makes the sun and the
// moon look like different weights. CSS that sizes the svg (affordances, help rows) still wins.
const ICON_SIZE = '0.875rem';

export function Icon({ name, size = ICON_SIZE, className }: C.IconProps) {
  const G = GLYPH[name];
  return <G aria-hidden className={className} size={size} />;
}

// --- controls ------------------------------------------------------------------------------------

export function Dialog({
  open,
  onOpenChange,
  initialFocus,
  layout,
  flush,
  className,
  children,
}: C.DialogProps) {
  return (
    <DS.Dialog open={open} onOpenChange={onOpenChange}>
      <DS.DialogContent
        size={layout === 'full' ? 'full' : undefined}
        padding={flush ? 'none' : undefined}
        className={className}
        showCloseButton={false}
        aria-describedby={undefined}
        {...(initialFocus
          ? {
              onOpenAutoFocus: (e: { preventDefault(): void }) => {
                e.preventDefault();
                requestAnimationFrame(() => initialFocus.current?.focus({ preventScroll: true }));
              },
            }
          : {})}
      >
        {children}
      </DS.DialogContent>
    </DS.Dialog>
  );
}
export const DialogTitle = ({ ref, mono, ...p }: C.DialogTitleProps) => (
  <DS.DialogTitle ref={ref} variant={mono ? 'code' : undefined} {...p} />
);
export const DialogDescription = ({ micro, ...p }: C.DialogDescriptionProps) => (
  <DS.DialogDescription variant={micro ? 'micro' : undefined} {...p} />
);

const panel = sidePanel({
  Layout: DS.ContentLayout,
  Main: DS.ContentLayoutMain,
  Panel: DS.SidePanel,
  Header: DS.SidePanelHeader,
  Body: DS.SidePanelBody,
  Close: DS.SidePanelCloseButton,
});
export const SidePanelLayout = panel.SidePanelLayout;
export const SidePanelMain = panel.SidePanelMain;
export const SidePanel = panel.SidePanel;

// The design system's inline Slider: label, track and value on one line at the toolbar's sm control
// height; the row, its label and value dim with the track when it is disabled.
export const Slider = ({
  value,
  onValueChange,
  min,
  step,
  formatValue,
  ...rest
}: C.SliderProps) => (
  <DS.Slider
    {...rest}
    layout="inline"
    size="sm"
    showValue
    value={[value]}
    {...(min !== undefined ? { min } : {})}
    {...(step !== undefined ? { step } : {})}
    {...(formatValue ? { formatValue: ([v]: number[]) => formatValue(v) } : {})}
    onValueChange={([v]: number[]) => onValueChange(v)}
  />
);

export const Switch = ({ checked, onCheckedChange, label, disabled }: C.SwitchProps) => (
  <DS.Switch
    checked={checked}
    onCheckedChange={onCheckedChange}
    aria-label={label}
    disabled={disabled}
  />
);

export const SegmentedChoice = ({
  label,
  value,
  onValueChange,
  options,
}: C.SegmentedChoiceProps) => (
  <DS.ToggleGroup
    type="single"
    value={value}
    onValueChange={(v: string) => v && onValueChange(v)}
    aria-label={label}
  >
    {options.map((o) => (
      <DS.ToggleGroupItem
        key={o.value}
        value={o.value}
        title={o.title}
        aria-label={o.accessibleLabel}
      >
        {o.label}
      </DS.ToggleGroupItem>
    ))}
  </DS.ToggleGroup>
);

export const Toolbar = ({ size, bar, className, children }: C.ToolbarProps) => (
  <DS.Toolbar
    size={size}
    variant={bar ? 'bar' : undefined}
    align={bar ? 'center' : undefined}
    className={className}
  >
    {children}
  </DS.Toolbar>
);
export const ToolbarStart = ({ children }: C.ToolbarStartProps) => (
  <DS.ToolbarLeft>{children}</DS.ToolbarLeft>
);
export const ToolbarEnd = ({ children }: C.ToolbarEndProps) => (
  <DS.ToolbarRight>{children}</DS.ToolbarRight>
);
export const ToolbarField = ({ label, minInlineSize, grow, children }: C.ToolbarFieldProps) => (
  <DS.ToolbarFormField
    label={label}
    minInlineSize={minInlineSize}
    {...(grow ? { flexGrow: 1 } : {})}
  >
    {children}
  </DS.ToolbarFormField>
);
export const ToolbarSummary = ({ live, children }: C.ToolbarSummaryProps) => (
  <DS.ToolbarSummary live={live}>{children}</DS.ToolbarSummary>
);

export const CopyValue = ({ value }: C.CopyValueProps) => <DS.CopyValue value={value} />;
export const Kbd = ({ children }: C.KbdProps) => <DS.Kbd size="sm">{children}</DS.Kbd>;
export const Tooltip = ({ content, children }: C.TooltipProps) => (
  <DS.Tooltip>
    <DS.TooltipTrigger asChild>{children}</DS.TooltipTrigger>
    <DS.TooltipContent side="bottom">{content}</DS.TooltipContent>
  </DS.Tooltip>
);

export function Link({ href, external, title, className, render, children }: C.LinkProps) {
  if (render)
    return render({
      href,
      title,
      className,
      children,
      ...(external ? { target: '_blank', rel: 'noreferrer' } : {}),
    });
  return (
    <DS.Link href={href} external={external} title={title} className={className}>
      {children}
    </DS.Link>
  );
}

export const Progress = ({ value, label, showLabel, className }: C.ProgressProps) =>
  showLabel ? (
    <DS.Progress className={className} value={value} showValue label={label} />
  ) : (
    <DS.Progress className={className} value={value} aria-label={label} />
  );

export const KeyValueList = ({ orientation, labelWidth, children }: C.KeyValueListProps) => (
  <DS.StaticList
    {...(orientation === 'horizontal' ? { orientation } : {})}
    {...(labelWidth ? { labelWidth } : {})}
  >
    {children}
  </DS.StaticList>
);
export const KeyValueItem = ({ label, children }: C.KeyValueItemProps) => (
  <DS.StaticListItem label={label}>{children}</DS.StaticListItem>
);

const alert = alertParts({
  Alert: DS.Alert,
  Title: DS.AlertTitle,
  Description: DS.AlertDescription,
});
export const Alert = alert.Alert;
export const AlertTitle = alert.AlertTitle;
export const AlertDescription = alert.AlertDescription;

export const SearchField = ({ id, value, onValueChange, placeholder }: C.SearchFieldProps) => (
  <DS.SearchBar id={id} value={value} onValueChange={onValueChange} placeholder={placeholder} />
);
export const TextField = textField(DS.Input);

export const Select = ({
  id,
  value,
  onValueChange,
  options,
  label,
  size,
  inlineSize,
}: C.SelectProps) => (
  // The root passes `id` on to its trigger (untyped), so a toolbar field's label names it.
  <DS.Select {...((id ? { id } : {}) as object)} value={value} onValueChange={onValueChange}>
    <DS.SelectTrigger
      {...(size ? { size } : {})}
      {...(label ? { 'aria-label': label } : {})}
      {...(inlineSize ? { style: { inlineSize } } : {})}
    >
      <DS.SelectValue />
    </DS.SelectTrigger>
    <DS.SelectContent>
      {options.map((o) => (
        <DS.SelectItem key={o.value} value={o.value}>
          {o.label}
        </DS.SelectItem>
      ))}
    </DS.SelectContent>
  </DS.Select>
);

// --- charts: the design system's Chart (recharts + tokens) ---------------------------------------

/** Categorical colours from the chart tokens, in a fixed order; text stays in text tokens. */
/** The default value format. Declared once: a default parameter that is a function stops the React Compiler. */
const plain = (v: number) => String(v);

const SERIES = [vars.color.chart1, vars.color.chart2, vars.color.chart3, vars.color.chart4];

function ChartDrawing({
  kind,
  data,
  series,
  x,
  format = plain,
  max,
  height,
  className,
  a11y,
}: C.ChartProps & { a11y: ChartA11y }) {
  const config = Object.fromEntries(
    series.map((sd, i) => [sd.key, { label: sd.label, color: SERIES[i % SERIES.length] }])
  );
  return (
    <ChartContainer config={config} className={className} style={{ blockSize: height }}>
      {kind === 'bar' ? (
        <RBarChart
          data={data}
          layout="vertical"
          margin={{ left: 8, right: 24 }}
          barGap={2}
          {...a11y}
        >
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            domain={[0, max ?? 'auto']}
            tickFormatter={format}
            tickLine={false}
            axisLine={false}
          />
          <YAxis type="category" dataKey={x} width={150} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
          {series.map((sd) => (
            <Bar
              key={sd.key}
              dataKey={sd.key}
              fill={`var(--color-${sd.key})`}
              radius={[0, 4, 4, 0]}
            />
          ))}
        </RBarChart>
      ) : (
        <RLineChart data={data} margin={{ left: 8, right: 24, top: 8 }} {...a11y}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={x} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={format} tickLine={false} axisLine={false} width={48} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
          {series.map((sd) => (
            // Points are solid in the series colour, no outline, smaller than the line's weight
            // suggests, so the line reads first; the one under the pointer grows a little.
            <Line
              key={sd.key}
              dataKey={sd.key}
              stroke={`var(--color-${sd.key})`}
              strokeWidth={2}
              dot={{ r: 2.5, fill: `var(--color-${sd.key})`, stroke: 'none', strokeWidth: 0 }}
              activeDot={{ r: 3.5, fill: `var(--color-${sd.key})`, stroke: 'none', strokeWidth: 0 }}
              isAnimationActive={false}
            />
          ))}
        </RLineChart>
      )}
    </ChartContainer>
  );
}

/** The chart's SVG, its one tab stop, named by label and described by summary (chart-a11y.tsx). */
export const Chart = withChartSummary(ChartDrawing);
