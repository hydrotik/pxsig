/**
 * The pxsig dashboard, built with a UI adapter chosen at build time (see build-config.mjs). With
 * nothing set it is the plain adapter; with PXSIG_DS_SOURCE set, the reference adapter on
 * @hydrotik/design-system, compiled from that checkout:
 *
 *   pnpm --filter @pxsig/dashboard build                                     # plain
 *   PXSIG_DS_SOURCE=/path/to/design-system-monorepo pnpm --filter @pxsig/dashboard build
 *   PXSIG_UI_ADAPTER=./path/to/adapter pnpm --filter @pxsig/dashboard build
 *
 * The output goes to packages/pxsig/dist/dashboard/ (or PXSIG_DASHBOARD_OUT), which ships in the
 * `pxsig` npm package and is never committed. It is a classic (IIFE) script so a static report also
 * opens from disk, and unminified unless PXSIG_DASHBOARD_MINIFY=1 is set.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { version as viteVersion } from 'vite';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { dashboardConfig } from './build-config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export default () =>
  dashboardConfig({
    cwd: process.env.INIT_CWD ?? process.cwd(),
    outDir: process.env.PXSIG_DASHBOARD_OUT
      ? path.resolve(process.env.PXSIG_DASHBOARD_OUT)
      : path.resolve(here, '../pxsig/dist/dashboard'),
    resolveFrom: [here],
    react,
    vanillaExtractPlugin,
    viteVersion,
  });
