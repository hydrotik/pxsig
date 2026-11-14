/// <reference types="node" />
/**
 * The source-parity page (test/harness/parity), built with an adapter for scripts/parity-check.mjs.
 * Here, beside the dashboard's own Vite config, so vite and its plugins resolve from this package.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardConfig } from './build-config.mjs';
import { classicScript } from './postbuild.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The page's source, relative to this package. */
const PAGE = 'test/harness/parity/index.html';

/**
 * Build the parity page with `adapter` (a built-in name or a path; unset: the one the dashboard
 * build would use) into `outDir`.
 * @param {{ adapter?: string, cwd: string, outDir: string }} o
 */
export async function buildParityPage({ adapter, cwd, outDir }) {
  const { build, version } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { vanillaExtractPlugin } = await import('@vanilla-extract/vite-plugin');
  const config = await dashboardConfig({
    adapter,
    cwd,
    outDir,
    resolveFrom: [here],
    react,
    vanillaExtractPlugin,
    viteVersion: version,
  });
  // The dashboard stays Vite's root (class names, the adapter's class prefixes and `@ui` are
  // resolved from it); the page is the build's one input. It lands at PAGE under outDir, and moves
  // to outDir/index.html, beside assets/.
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
  await build(inline);
  const built = path.join(outDir, PAGE);
  writeFileSync(
    path.join(outDir, 'index.html'),
    readFileSync(built, 'utf8').replaceAll('../../../assets/', './assets/')
  );
  rmSync(path.join(outDir, 'test'), { recursive: true, force: true });
  // As the dashboard loads it: a classic script, whose own URL its font URLs resolve against.
  classicScript(outDir);
}
