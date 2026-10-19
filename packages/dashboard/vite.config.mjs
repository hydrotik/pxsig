/**
 * The pxsig dashboard: a React app built on @hydrotik/design-system, which is not published yet.
 *
 *   PXSIG_DS_SOURCE=/path/to/design-system-monorepo pnpm --filter @pxsig/dashboard build
 *
 * The build finds the design system, its tokens and its theme provider by package name in that
 * checkout and compiles them from source (vanilla-extract runs on their .css.ts files). The output
 * goes to packages/pxsig/dist/dashboard/, which ships in the `pxsig` npm package and is never
 * committed. It is a classic (IIFE) script so a static report also opens from disk.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.env.PXSIG_DS_SOURCE;
if (!source || !existsSync(source)) throw new Error('set PXSIG_DS_SOURCE to a checkout of the design-system monorepo');

/** Package name → folder, for every package.json one or two levels under the checkout's package folders. */
function packagesIn(root) {
  const out = {};
  for (const group of ['packages', 'apps']) {
    const dir = path.join(root, group);
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const pj = path.join(dir, d.name, 'package.json');
      if (!d.isDirectory() || !existsSync(pj)) continue;
      try {
        out[JSON.parse(readFileSync(pj, 'utf8')).name] = path.join(dir, d.name);
      } catch {
        // not a package
      }
    }
  }
  return out;
}
const pkgs = packagesIn(source);
const need = (name) => pkgs[name] ?? (() => { throw new Error(`${name} not found in ${source}`); })();
const ds = need('@hydrotik/design-system');
const dsModules = path.join(ds, 'node_modules');
const own = path.join(here, 'node_modules');

export default {
  root: here,
  base: './',
  plugins: [
    // vanilla-extract compiles .css.ts on a Vite server of its own that keeps our plugins but not
    // our server options: this plugin lets that server, too, read the design system's sources.
    { name: 'pxsig-allow-design-system', config: () => ({ server: { fs: { allow: [here, source] } } }) },
    react(),
    vanillaExtractPlugin({ unstable_pluginFilter: ({ name }) => name === 'pxsig-allow-design-system' || name === 'vite-tsconfig-paths' }),
  ],
  logLevel: 'warn',
  resolve: {
    alias: {
      '@hydrotik/design-system/chart': path.join(ds, 'src/chart.ts'),
      '@hydrotik/design-system': path.join(ds, 'src'),
      '@hydrotik/tokens': path.join(need('@hydrotik/tokens'), 'src'),
      '@hydrotik/theme-provider': path.join(need('@hydrotik/theme-provider'), 'src'),
      // One copy of each runtime: the design system's vanilla-extract and charts, our React.
      '@vanilla-extract/css': path.join(dsModules, '@vanilla-extract/css'),
      '@vanilla-extract/recipes': path.join(dsModules, '@vanilla-extract/recipes'),
      recharts: path.join(dsModules, 'recharts'),
      react: path.join(own, 'react'),
      'react-dom': path.join(own, 'react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: { exclude: ['@vanilla-extract/css', '@vanilla-extract/css/fileScope', '@vanilla-extract/recipes'] },
  build: {
    outDir: path.resolve(here, '../pxsig/dist/dashboard'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    modulePreload: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'assets/app.js', assetFileNames: 'assets/[name][extname]' } },
  },
};
