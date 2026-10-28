/// <reference types="node" />
/**
 * Build settings for the hydrotik adapter. @hydrotik/design-system is not published: the build
 * compiles it, its tokens and its theme provider from a local checkout of the monorepo that holds
 * them, named by PXSIG_DS_SOURCE.
 *
 * An adapter folder may carry a `vite.mjs` like this one; the dashboard build merges what it
 * returns ({ alias, allow, dedupe, optimizeDepsExclude }) into its own config.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Package name → folder, for every package.json one level under the checkout's package folders.
 * @param {string} root
 * @returns {Record<string, string>}
 */
export function packagesIn(root) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const group of ['packages', 'apps']) {
    const dir = path.join(root, group);
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const pj = path.join(dir, d.name, 'package.json');
      if (!d.isDirectory() || !existsSync(pj)) continue;
      try {
        // A package.json: its `name` is the key.
        out[/** @type {{ name: string }} */ (JSON.parse(readFileSync(pj, 'utf8'))).name] =
          path.join(dir, d.name);
      } catch {
        // not a package
      }
    }
  }
  return out;
}

/**
 * The build settings the dashboard build merges into its config.
 * @returns {{ allow: string[], alias: Record<string, string>, optimizeDepsExclude: string[] }}
 */
export default function hydrotik() {
  const source = process.env.PXSIG_DS_SOURCE;
  if (!source || !existsSync(source))
    throw new Error(
      '[pxsig ui] the hydrotik adapter needs PXSIG_DS_SOURCE: a checkout of the design-system monorepo'
    );
  const pkgs = packagesIn(source);
  /** @param {string} name @returns {string} */
  const need = (name) =>
    pkgs[name] ??
    (() => {
      throw new Error(`[pxsig ui] ${name} not found in ${source}`);
    })();
  const ds = need('@hydrotik/design-system');
  const dsModules = path.join(ds, 'node_modules');
  return {
    allow: [source],
    alias: {
      '@hydrotik/design-system/chart': path.join(ds, 'src/chart.ts'),
      '@hydrotik/design-system/fonts': path.join(ds, 'src/fonts.ts'),
      '@hydrotik/design-system/styles': path.join(ds, 'src/styles.ts'),
      '@hydrotik/design-system': path.join(ds, 'src'),
      '@hydrotik/tokens': path.join(need('@hydrotik/tokens'), 'src'),
      '@hydrotik/theme-provider': path.join(need('@hydrotik/theme-provider'), 'src'),
      // One copy of each runtime: the design system's vanilla-extract and charts.
      '@vanilla-extract/css': path.join(dsModules, '@vanilla-extract/css'),
      '@vanilla-extract/recipes': path.join(dsModules, '@vanilla-extract/recipes'),
      recharts: path.join(dsModules, 'recharts'),
    },
    optimizeDepsExclude: [
      '@vanilla-extract/css',
      '@vanilla-extract/css/fileScope',
      '@vanilla-extract/recipes',
    ],
  };
}
