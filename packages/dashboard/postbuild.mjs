/// <reference types="node" />
// The dashboard is built twice (build-config.mjs): ES-module chunks, which `pxsig serve` serves,
// and in `classic/` one classic script (IIFE), which also runs from file://, where module scripts
// are blocked: the static report (`pxsig report`) is made from it.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The classic build's folder, inside a dashboard build. */
export const CLASSIC = 'classic';

/**
 * Rewrites the built index.html in `outDir` to load the bundle as a classic script.
 * @param {string} outDir
 */
export function classicScript(outDir) {
  const index = path.join(outDir, 'index.html');
  writeFileSync(
    index,
    readFileSync(index, 'utf8')
      .replace(
        /<script type="module" crossorigin src="([^"]+)"><\/script>/,
        '<script defer src="$1"></script>'
      )
      .replace(/ crossorigin/g, '')
  );
}

/**
 * Both builds into `outDir`: the module build at its top, then the classic one in `classic/`.
 * `configOf(format, outDir)` is build-config.mjs's dashboardConfig with the caller's settings.
 * @param {{ build: (config: Record<string, unknown>) => Promise<unknown> }} vite
 * @param {(format: 'es' | 'iife', outDir: string) => Promise<Record<string, unknown>>} configOf
 * @param {string} outDir
 */
export async function buildBoth(vite, configOf, outDir) {
  // The module build first: it empties outDir, classic/ included.
  await vite.build({ ...(await configOf('es', outDir)), configFile: false });
  const classic = path.join(outDir, CLASSIC);
  await vite.build({ ...(await configOf('iife', classic)), configFile: false });
  classicScript(classic);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.env.PXSIG_DASHBOARD_OUT
    ? path.resolve(process.env.PXSIG_DASHBOARD_OUT)
    : fileURLToPath(new URL('../pxsig/dist/dashboard', import.meta.url));
  classicScript(path.join(out, CLASSIC));
}
