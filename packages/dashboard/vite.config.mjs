/**
 * The pxsig dashboard, built with a UI adapter chosen at build time (see build-config.mjs). In this
 * repository the dashboard is the hydrotik design system's: build it through the package's `build`
 * script (scripts/dashboard-build.mjs), which, with no adapter named, compiles the `hydrotik`
 * adapter from the design system pinned in design-system.json (fetched into target/design-system,
 * `pnpm ds:fetch`) or from a checkout PXSIG_DS_SOURCE names:
 *
 *   pnpm build:dashboard                                       # hydrotik, at the pinned commit
 *   PXSIG_DS_SOURCE=<design-system checkout> pnpm build:dashboard   # hydrotik, from that checkout
 *   PXSIG_UI_ADAPTER=plain pnpm build:dashboard                # another adapter, by name or path
 *
 * Run by Vite directly with no adapter named and no PXSIG_DS_SOURCE, this config refuses to build
 * rather than build plain. The output goes to packages/pxsig/dist/dashboard/ (or
 * PXSIG_DASHBOARD_OUT), which ships in the `pxsig` npm package and is never committed. It is a
 * classic (IIFE) script so a static report also opens from disk, and unminified unless
 * PXSIG_DASHBOARD_MINIFY=1 is set.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { version as viteVersion } from 'vite';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { adapterSpec, dashboardConfig } from './build-config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export default () => {
  const cwd = process.env.INIT_CWD ?? process.cwd();
  if (adapterSpec({ cwd }).from === 'default')
    throw new Error(
      '[pxsig ui] no adapter named: build with `pnpm build:dashboard` (scripts/dashboard-build.mjs), which builds the hydrotik design system at the pinned commit, or name one with PXSIG_UI_ADAPTER'
    );
  return dashboardConfig({
    cwd,
    outDir: process.env.PXSIG_DASHBOARD_OUT
      ? path.resolve(process.env.PXSIG_DASHBOARD_OUT)
      : path.resolve(here, '../pxsig/dist/dashboard'),
    resolveFrom: [here],
    react,
    vanillaExtractPlugin,
    viteVersion,
  });
};
