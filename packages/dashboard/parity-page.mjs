/// <reference types="node" />
/**
 * The source-parity page (parity/), built with an adapter: what `pxsig dashboard parity` sets
 * beside the design system's stories (docs/ui/build-adapter.md, "Source parity"). Ships in the pxsig
 * package beside build-config.mjs, as the dashboard's source does.
 *
 * The caller passes Vite's `build` and its plugins (`pxsig dashboard parity` loads them from the
 * project, as `pxsig dashboard build` does); without them they are imported from beside this file
 * (this repository's own scripts). The dashboard folder stays Vite's root, so the adapter's class
 * prefixes and `@ui` resolve as in the dashboard's build; the page is the build's one input, moved
 * to `<outDir>/index.html` beside `assets/`, and loaded as a classic script as the dashboard is
 * (the stylesheet's font URLs resolve against the script's own).
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardConfig } from './build-config.mjs';
import { classicScript } from './postbuild.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The page's source, relative to this folder. */
export const PAGE = 'parity/index.html';

/**
 * @typedef {{ build: (config: import('vite').InlineConfig) => Promise<unknown>, version?: string }} ViteLike
 */

/**
 * Build the parity page with `adapter` (a built-in name or a path; unset: the one the dashboard
 * build would use) into `outDir`.
 * @param {{ adapter?: string, cwd: string, outDir: string, resolveFrom?: string[], vite?: ViteLike, react?: () => unknown, vanillaExtractPlugin?: Parameters<typeof dashboardConfig>[0]['vanillaExtractPlugin'] }} o
 */
export async function buildParityPage({
  adapter,
  cwd,
  outDir,
  resolveFrom = [here],
  vite,
  react,
  vanillaExtractPlugin,
}) {
  const v = vite ?? (await import('vite'));
  const r = react ?? (await import('@vitejs/plugin-react')).default;
  const ve =
    vanillaExtractPlugin ?? (await import('@vanilla-extract/vite-plugin')).vanillaExtractPlugin;
  const config = await dashboardConfig({
    adapter,
    cwd,
    outDir,
    resolveFrom,
    react: r,
    vanillaExtractPlugin: ve,
    root: here,
    viteVersion: v.version,
  });
  // The config's plugins and output format are typed loosely by build-config.mjs.
  const inline = /** @type {import('vite').InlineConfig} */ ({
    ...config,
    configFile: false,
    logLevel: 'warn',
    build: {
      ...config.build,
      rollupOptions: { ...config.build.rollupOptions, input: path.join(here, PAGE) },
    },
  });
  await v.build(inline);
  writeFileSync(
    path.join(outDir, 'index.html'),
    readFileSync(path.join(outDir, PAGE), 'utf8').replaceAll('../assets/', './assets/')
  );
  rmSync(path.join(outDir, path.dirname(PAGE)), { recursive: true, force: true });
  classicScript(outDir);
}
