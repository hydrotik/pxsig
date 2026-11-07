/**
 * `@ui`: the active UI surface. Re-exports the build-selected adapter (`@ui-adapter`, see
 * vite.config.mjs) under the contract's names, with the plain fallback for any optional component
 * the adapter lacks, plus the contract types and the theme-mode runtime. Views, parts, the
 * inspector and App.tsx import components from here only.
 */
import React from 'react';
import * as selected from '@ui-adapter';
import {
  CONTRACT,
  CONTRACT_VERSION,
  COMPONENT_NAMES,
  ICON_DEFAULTS,
  type ComponentName,
  type ComponentProps,
  type DataTableProps,
  type IconName,
  type UiAdapter,
} from './contract';
import { fallbacks } from './fallbacks';
import { ThemeModeProvider, installTokens, useThemeMode } from './runtime';

export * from './contract';
export { useThemeMode };

/** The adapter module's named exports (`name`, `tokens`, the components). */
const adapter = selected as unknown as UiAdapter;
const missing = COMPONENT_NAMES.filter(
  (n) =>
    CONTRACT[n].required &&
    typeof (adapter as Record<string, unknown>)[n] !== 'function' &&
    typeof (adapter as Record<string, unknown>)[n] !== 'object'
);
if (missing.length)
  throw new Error(
    `[pxsig ui] the "${adapter.name ?? '?'}" adapter does not export the required component(s): ${missing.join(', ')}`
  );
installTokens(adapter.tokens);

/** The adapter's component, else the plain fallback (optional components only). */
function pick<K extends ComponentName>(name: K): React.ComponentType<ComponentProps[K]> {
  return ((adapter as Record<string, unknown>)[name] ??
    (fallbacks as Record<string, unknown>)[name]) as React.ComponentType<ComponentProps[K]>;
}

/** The adapter in use, for diagnostics. */
export const adapterName: string = adapter.name;

const Provider = pick('UiProvider');
/** The app's root: owns theme mode and hands it to the adapter's provider. */
export function UiRoot({ children }: { children: React.ReactNode }) {
  return React.createElement(ThemeModeProvider, {
    children: (mode: 'light' | 'dark') => React.createElement(Provider, { mode, children }),
  });
}

export const AppShell = pick('AppShell');
export const AppMain = pick('AppMain');
export const TopNav = pick('TopNav');
export const NavList = pick('NavList');
export const NavLink = pick('NavLink');
export const NavEnd = pick('NavEnd');
export const Button = pick('Button');
export const IconButton = pick('IconButton');
export const Card = pick('Card');
export const CardHeader = pick('CardHeader');
export const CardTitle = pick('CardTitle');
export const CardDescription = pick('CardDescription');
export const CardContent = pick('CardContent');
export const StatGroup = pick('StatGroup');
export const DataTable = pick('DataTable') as unknown as <T>(
  props: DataTableProps<T>
) => React.ReactElement | null;
/**
 * The side panel's three parts come as a set: the adapter's when it exports all three, else the
 * three fallbacks (a design system's panel can need its own layout around it, since 1.3.0).
 */
const PANEL = ['SidePanelLayout', 'SidePanelMain', 'SidePanel'] as const;
const ownPanel = PANEL.every((n) => (adapter as Record<string, unknown>)[n] != null);
const panelPart = <K extends (typeof PANEL)[number]>(name: K) =>
  (ownPanel ? pick(name) : fallbacks[name]) as React.ComponentType<ComponentProps[K]>;
export const SidePanelLayout = panelPart('SidePanelLayout');
export const SidePanelMain = panelPart('SidePanelMain');
export const SidePanel = panelPart('SidePanel');
export const StatusBadge = pick('StatusBadge');
export const Badge = pick('Badge');
/** The contract version the adapter was written for (its conformance.json; the build defines it). */
declare const __PXSIG_ADAPTER_CONTRACT__: string | undefined;
const adapterContract =
  typeof __PXSIG_ADAPTER_CONTRACT__ === 'string' ? __PXSIG_ADAPTER_CONTRACT__ : CONTRACT_VERSION;
const older = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};
const AdapterIcon = pick('Icon');
const iconDefaults: Partial<Record<IconName, { since: string; draw: IconName }>> = ICON_DEFAULTS;
/** The adapter's Icon; an icon newer than the adapter's contract is drawn as its default. */
export const Icon = (props: ComponentProps['Icon']) => {
  const d = iconDefaults[props.name];
  return React.createElement(
    AdapterIcon,
    d && older(adapterContract, d.since) ? { ...props, name: d.draw } : props
  );
};
export const Dialog = pick('Dialog');
export const DialogTitle = pick('DialogTitle');
export const DialogDescription = pick('DialogDescription');
/** The adapter's control, or the fallback while disabled on an adapter older than `min`. */
function since<K extends 'Switch' | 'Slider'>(name: K, min: string) {
  const own = pick(name);
  const fallback = fallbacks[name] as React.ComponentType<ComponentProps[K]>;
  return (props: ComponentProps[K]) =>
    React.createElement(props.disabled && older(adapterContract, min) ? fallback : own, props);
}
export const Slider = since('Slider', '1.2.0');
export const Switch = since('Switch', '1.2.0');
export const SegmentedChoice = pick('SegmentedChoice');
export const Toolbar = pick('Toolbar');
export const ToolbarStart = pick('ToolbarStart');
export const ToolbarEnd = pick('ToolbarEnd');
export const ToolbarField = pick('ToolbarField');
export const ToolbarSummary = pick('ToolbarSummary');
export const CopyValue = pick('CopyValue');
export const Kbd = pick('Kbd');
export const Tooltip = pick('Tooltip');
export const Link = pick('Link');
export const Progress = pick('Progress');
export const KeyValueList = pick('KeyValueList');
export const KeyValueItem = pick('KeyValueItem');
export const Alert = pick('Alert');
export const AlertTitle = pick('AlertTitle');
export const AlertDescription = pick('AlertDescription');
export const SearchField = pick('SearchField');
export const TextField = pick('TextField');
export const Select = pick('Select');
export const Chart = pick('Chart');
export const Heatmap = pick('Heatmap');
