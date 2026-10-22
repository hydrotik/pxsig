/**
 * The reference adapter: the UI contract on @hydrotik/design-system (the dashboard's look since
 * 0.1). Each component maps the contract's neutral props onto the design system's own, and
 * renders exactly what the views rendered before the contract existed.
 */
import React from 'react';
import '@hydrotik/design-system/fonts';
import * as DS from '@hydrotik/design-system';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@hydrotik/design-system/chart';
import { ThemeProvider, useTheme } from '@hydrotik/theme-provider';
import { vars } from '@hydrotik/tokens';
import { Bar, BarChart as RBarChart, CartesianGrid, Line, LineChart as RLineChart, XAxis, YAxis } from 'recharts';
import type * as C from '../../contract';

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
  'color.focus': vars.color.focusRing,
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
  'line.emphasis': vars.ring.width,
  // The design system's fastest duration is 100ms; the dashboard's hover fades have always been 120ms.
  'motion.fast': '120ms',
};

// --- shell ---------------------------------------------------------------------------------------

/** Keeps the design system's theme in step with the contract runtime's mode. */
function SyncMode({ mode }: { mode: C.ThemeMode }) {
  const { theme, setTheme } = useTheme();
  React.useEffect(() => {
    if (theme !== mode) setTheme(mode);
  }, [mode, theme, setTheme]);
  return null;
}

export function UiProvider({ mode, children }: C.UiProviderProps) {
  return (
    <ThemeProvider defaultTheme={mode} storageKey="pxsig-dashboard-theme">
      <SyncMode mode={mode} />
      <DS.TooltipProvider>{children}</DS.TooltipProvider>
    </ThemeProvider>
  );
}

export const AppShell = ({ children }: C.AppShellProps) => <DS.AppShell>{children}</DS.AppShell>;

export const AppMain = ({ ref, children }: C.AppMainProps) => (
  <DS.AppShellContent asChild>
    <main ref={ref as React.Ref<HTMLElement>}>{children}</main>
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
  countTone: countTone === undefined ? undefined : countTone === 'info' ? ('attention' as const) : ('neutral' as const),
  // A count over 99 shows as "99+": the name says so too, so it contains what is on screen.
  countLabel: count !== undefined && count > 99 ? `99+, ${countLabel ?? count}` : countLabel,
});

export const NavLink = (p: C.NavLinkProps) => <DS.NavItemLink {...navItemProps(p)}>{p.children}</DS.NavItemLink>;

/**
 * The design system's NavItems finds its links by element type (to measure them and move the ones
 * that do not fit into its More menu), so each contract NavLink becomes a NavItemLink here.
 */
export const NavList = ({ children }: C.NavListProps) => (
  <DS.NavItems>
    {React.Children.map(children, (c) =>
      React.isValidElement<C.NavLinkProps>(c) && c.type === NavLink ? (
        <DS.NavItemLink key={c.key ?? undefined} {...navItemProps(c.props)}>
          {c.props.children}
        </DS.NavItemLink>
      ) : (
        c
      )
    )}
  </DS.NavItems>
);

export const NavEnd = ({ className, children }: C.NavEndProps) => <div className={className}>{children}</div>;

// --- core ----------------------------------------------------------------------------------------

const VARIANT = { solid: 'default', outline: 'outline', ghost: 'ghost' } as const;

export function Button({ emphasis = 'solid', size, href, external, children, ...rest }: C.ButtonProps) {
  const variant = VARIANT[emphasis];
  if (href)
    return (
      <DS.Button asChild size={size} variant={variant}>
        <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} title={rest.title} aria-label={rest['aria-label']}>
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

export const IconButton = ({ label, title, emphasis = 'outline', size, disabled, onClick, children }: C.IconButtonProps) => (
  <DS.Button size={size === 'sm' ? 'icon-sm' : 'icon'} variant={emphasis} aria-label={label} title={title} disabled={disabled} onClick={onClick}>
    {children}
  </DS.Button>
);

export const Card = ({ children }: C.CardProps) => <DS.Card>{children}</DS.Card>;
export const CardHeader = ({ children }: C.CardHeaderProps) => <DS.CardHeader>{children}</DS.CardHeader>;
export const CardTitle = ({ children }: C.CardTitleProps) => <DS.CardTitle>{children}</DS.CardTitle>;
export const CardDescription = ({ className, children }: C.CardDescriptionProps) => <DS.CardDescription className={className}>{children}</DS.CardDescription>;
export const CardContent = ({ children }: C.CardContentProps) => <DS.CardContent>{children}</DS.CardContent>;

/** Tone → the stat card's accent (only the states it colours). */
const ACCENT: Partial<Record<C.Tone, 'success' | 'error' | 'warning'>> = { success: 'success', danger: 'error', warning: 'warning' };

export const StatGroup = ({ label, items, layout, className }: C.StatGroupProps) => (
  <DS.StatPanel
    className={className}
    variant={layout === 'strip' ? 'strip' : undefined}
    aria-label={label}
    cards={items.map((it) => ({
      label: it.label,
      value: it.value,
      ...(it.unit !== undefined ? { unit: it.unit } : {}),
      ...(it.tone ? { accent: ACCENT[it.tone] } : {}),
      ...(it.onSelect ? { type: 'filter' as const, onSelect: it.onSelect, ...(it.active !== undefined ? { active: it.active } : {}), icon: it.icon } : {}),
    }))}
  />
);

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
const GLYPH: Record<C.IconName, React.ComponentType<{ 'aria-hidden'?: boolean | 'true'; className?: string; size?: string | number }>> = {
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

const STATUS_TONE: Record<C.Tone, 'neutral' | 'info' | 'success' | 'warning' | 'error'> = { neutral: 'neutral', info: 'info', success: 'success', warning: 'warning', danger: 'error' };

export const StatusBadge = ({ tone, icon, label, title, className }: C.StatusBadgeProps) => (
  <DS.StatusBadge label={label} tone={STATUS_TONE[tone]} icon={GLYPH[icon] as never} title={title} className={className} />
);

export function Badge({ tone = 'neutral', emphasis = 'subtle', pulse, title, className, children }: C.BadgeProps) {
  const variant = tone === 'neutral' ? (emphasis === 'outline' ? 'outline' : 'secondary') : tone === 'danger' ? 'destructive' : tone === 'info' ? 'default' : tone;
  return (
    <DS.Badge variant={variant} pulse={pulse} title={title} className={className}>
      {children}
    </DS.Badge>
  );
}

export function Icon({ name, size, className }: C.IconProps) {
  const G = GLYPH[name];
  return <G aria-hidden className={className} {...(size ? { size } : {})} />;
}

// --- controls ------------------------------------------------------------------------------------

export function Dialog({ open, onOpenChange, initialFocus, className, children }: C.DialogProps) {
  return (
    <DS.Dialog open={open} onOpenChange={onOpenChange}>
      <DS.DialogContent
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
export const DialogTitle = ({ ref, ...p }: C.DialogTitleProps) => <DS.DialogTitle ref={ref} {...p} />;
export const DialogDescription = (p: C.DialogDescriptionProps) => <DS.DialogDescription {...p} />;

export const Slider = ({ label, value, onValueChange, min, max, step, formatValue, className }: C.SliderProps) => (
  <DS.Slider
    className={className}
    label={label}
    showValue
    {...(formatValue ? { formatValue: ([v]: number[]) => formatValue(v) } : {})}
    value={[value]}
    {...(min !== undefined ? { min } : {})}
    max={max}
    {...(step !== undefined ? { step } : {})}
    onValueChange={([v]: number[]) => onValueChange(v)}
  />
);

export const Switch = ({ checked, onCheckedChange, label }: C.SwitchProps) => <DS.Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />;

export const SegmentedChoice = ({ label, value, onValueChange, options }: C.SegmentedChoiceProps) => (
  <DS.ToggleGroup type="single" value={value} onValueChange={(v: string) => v && onValueChange(v)} aria-label={label}>
    {options.map((o) => (
      <DS.ToggleGroupItem key={o.value} value={o.value} title={o.title} aria-label={o.accessibleLabel}>
        {o.label}
      </DS.ToggleGroupItem>
    ))}
  </DS.ToggleGroup>
);

export const Toolbar = ({ size, className, children }: C.ToolbarProps) => (
  <DS.Toolbar size={size} className={className}>
    {children}
  </DS.Toolbar>
);
export const ToolbarStart = ({ children }: C.ToolbarStartProps) => <DS.ToolbarLeft>{children}</DS.ToolbarLeft>;
export const ToolbarEnd = ({ children }: C.ToolbarEndProps) => <DS.ToolbarRight>{children}</DS.ToolbarRight>;
export const ToolbarField = ({ label, minInlineSize, grow, children }: C.ToolbarFieldProps) => (
  <DS.ToolbarFormField label={label} minInlineSize={minInlineSize} {...(grow ? { flexGrow: 1 } : {})}>
    {children}
  </DS.ToolbarFormField>
);
export const ToolbarSummary = ({ live, children }: C.ToolbarSummaryProps) => <DS.ToolbarSummary live={live}>{children}</DS.ToolbarSummary>;

export const CopyValue = ({ value }: C.CopyValueProps) => <DS.CopyValue value={value} />;
export const Kbd = ({ children }: C.KbdProps) => <DS.Kbd size="sm">{children}</DS.Kbd>;

export function Link({ href, external, title, className, render, children }: C.LinkProps) {
  if (render) return render({ href, title, className, children, ...(external ? { target: '_blank', rel: 'noreferrer' } : {}) });
  return (
    <DS.Link href={href} external={external} title={title} className={className}>
      {children}
    </DS.Link>
  );
}

export const Progress = ({ value, label, showLabel, className }: C.ProgressProps) =>
  showLabel ? <DS.Progress className={className} value={value} showValue label={label} /> : <DS.Progress className={className} value={value} aria-label={label} />;

export const KeyValueList = ({ orientation, labelWidth, children }: C.KeyValueListProps) => (
  <DS.StaticList {...(orientation === 'horizontal' ? { orientation } : {})} {...(labelWidth ? { labelWidth } : {})}>
    {children}
  </DS.StaticList>
);
export const KeyValueItem = ({ label, children }: C.KeyValueItemProps) => <DS.StaticListItem label={label}>{children}</DS.StaticListItem>;

export const Alert = ({ tone, label, children }: C.AlertProps) => (
  <DS.Alert variant={tone === 'danger' ? 'destructive' : 'default'} aria-label={label} style={{ boxSizing: 'border-box' }}>
    {children}
  </DS.Alert>
);
export const AlertTitle = ({ children }: C.AlertTitleProps) => <DS.AlertTitle>{children}</DS.AlertTitle>;
export const AlertDescription = ({ children }: C.AlertDescriptionProps) => <DS.AlertDescription>{children}</DS.AlertDescription>;

export const SearchField = ({ id, value, onValueChange, placeholder }: C.SearchFieldProps) => <DS.SearchBar id={id} value={value} onValueChange={onValueChange} placeholder={placeholder} />;

export const Select = ({ id, value, onValueChange, options, label, size, inlineSize }: C.SelectProps) => (
  // The root passes `id` on to its trigger (untyped), so a toolbar field's label names it.
  <DS.Select {...((id ? { id } : {}) as object)} value={value} onValueChange={onValueChange}>
    <DS.SelectTrigger {...(size ? { size } : {})} {...(label ? { 'aria-label': label } : {})} {...(inlineSize ? { style: { inlineSize } } : {})}>
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
const SERIES = [vars.color.chart1, vars.color.chart2, vars.color.chart3, vars.color.chart4];

export function Chart({ kind, data, series, x, format = (v: number) => String(v), max, height, className }: C.ChartProps) {
  const config = Object.fromEntries(series.map((sd, i) => [sd.key, { label: sd.label, color: SERIES[i % SERIES.length] }]));
  return (
    <ChartContainer config={config} className={className} style={{ blockSize: height }}>
      {kind === 'bar' ? (
        <RBarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }} barGap={2}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" domain={[0, max ?? 'auto']} tickFormatter={format} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey={x} width={150} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
          {series.map((sd) => (
            <Bar key={sd.key} dataKey={sd.key} fill={`var(--color-${sd.key})`} radius={[0, 4, 4, 0]} />
          ))}
        </RBarChart>
      ) : (
        <RLineChart data={data} margin={{ left: 8, right: 24, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={x} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={format} tickLine={false} axisLine={false} width={48} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
          {series.map((sd) => (
            <Line key={sd.key} dataKey={sd.key} stroke={`var(--color-${sd.key})`} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
          ))}
        </RLineChart>
      )}
    </ChartContainer>
  );
}
