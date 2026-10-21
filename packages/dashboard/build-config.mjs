/**
 * The dashboard's Vite config, shared by this repository's build (vite.config.mjs) and by
 * `pxsig dashboard build` in a consumer project. The caller passes the plugins and where to resolve
 * React from, so nothing here imports a build tool by itself.
 *
 * The UI adapter is chosen once, at build time:
 *   1. `adapter` (the `--ui` flag), else PXSIG_UI_ADAPTER, else `dashboard.ui` in the
 *      pxsig.config.json of the working folder, else `hydrotik`;
 *   2. a bare name (`hydrotik`) is a built-in adapter under src/ui/adapters/<name>/; anything else
 *      is a path to an adapter module (a file, or a folder with an index.tsx / .ts / .jsx / .js);
 *   3. anything else fails the build at once, naming what it looked for.
 * Vite aliases `@ui-adapter` to the module. An adapter folder may carry a `vite.mjs` whose default
 * export returns build settings (aliases, folders to allow) for its design system.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const builtins = path.join(here, 'src/ui/adapters');
const INDEX = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];

export const builtinAdapters = () => (existsSync(builtins) ? readdirSync(builtins, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);

/** The adapter spec in force, and where it came from. */
export function adapterSpec({ adapter, cwd = process.cwd() } = {}) {
  if (adapter) return { spec: adapter, base: cwd, from: '--ui' };
  if (process.env.PXSIG_UI_ADAPTER) return { spec: process.env.PXSIG_UI_ADAPTER, base: cwd, from: 'PXSIG_UI_ADAPTER' };
  const cfg = path.join(cwd, 'pxsig.config.json');
  if (existsSync(cfg)) {
    try {
      const ui = JSON.parse(readFileSync(cfg, 'utf8'))?.dashboard?.ui;
      if (ui) return { spec: ui, base: cwd, from: 'pxsig.config.json dashboard.ui' };
    } catch {
      // an unreadable config is reported by the commands that read it
    }
  }
  return { spec: 'hydrotik', base: cwd, from: 'default' };
}

/** The adapter's module file and folder, or an error that says what was looked for. */
export function resolveAdapter(opts = {}) {
  const { spec, base, from } = adapterSpec(opts);
  const known = builtinAdapters();
  if (/^[a-z0-9][a-z0-9-]*$/.test(spec)) {
    if (!known.includes(spec)) throw new Error(`[pxsig ui] unknown UI adapter "${spec}" (from ${from}). Built-in adapters: ${known.join(', ') || 'none'}; or pass a path to an adapter module.`);
    const dir = path.join(builtins, spec);
    const file = INDEX.map((f) => path.join(dir, f)).find(existsSync);
    if (!file) throw new Error(`[pxsig ui] the built-in adapter "${spec}" has no index file in ${dir}`);
    return { name: spec, file, dir, from };
  }
  const p = path.resolve(base, spec);
  let file = null;
  if (existsSync(p) && statSync(p).isDirectory()) file = INDEX.map((f) => path.join(p, f)).find(existsSync) ?? null;
  else if (existsSync(p)) file = p;
  else file = ['.tsx', '.ts', '.jsx', '.js'].map((e) => p + e).find(existsSync) ?? null;
  if (!file) throw new Error(`[pxsig ui] no UI adapter at "${spec}" (from ${from}; looked for ${p} and ${p}/index.{tsx,ts,jsx,js}). Built-in adapters: ${known.join(', ') || 'none'}.`);
  return { name: path.basename(statSync(p, { throwIfNoEntry: false })?.isDirectory() ? p : path.dirname(file)), file, dir: path.dirname(file), from };
}

/**
 * A package's folder, from the first of `fromDirs` that reaches it: node_modules/<name> in the
 * folder or a parent (what Node's resolution walks; works when a package's exports hide its
 * package.json).
 */
export function packageDir(name, fromDirs) {
  for (const start of fromDirs) {
    for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
      const pj = path.join(dir, 'node_modules', name, 'package.json');
      if (existsSync(pj)) return realpathSync(path.dirname(pj));
      if (path.dirname(dir) === dir) break;
    }
  }
  return null;
}

/**
 * @param {object} o
 * @param {string} [o.adapter]       --ui: a built-in name or a path
 * @param {string} [o.cwd]           where pxsig.config.json and relative paths are read
 * @param {string} o.outDir
 * @param {string[]} o.resolveFrom   folders to resolve react / react-dom / @vanilla-extract/css from
 * @param {Function} o.react         @vitejs/plugin-react's default export
 * @param {Function} o.vanillaExtractPlugin
 * @param {string} [o.root]          the dashboard source folder (default: this one)
 */
export async function dashboardConfig({ adapter, cwd, outDir, resolveFrom, react, vanillaExtractPlugin, root = here }) {
  const ui = resolveAdapter({ adapter, cwd });
  const extraFile = path.join(ui.dir, 'vite.mjs');
  const extra = existsSync(extraFile) ? await (await import(pathToFileURL(extraFile).href)).default() : {};
  const need = (name, from = resolveFrom) => packageDir(name, from) ?? (() => { throw new Error(`[pxsig ui] cannot resolve ${name} from ${from.join(', ')}: install it`); })();
  // @vanilla-extract/css: the adapter's copy if it pins one, else the one the plugin compiles with.
  const plugin = need('@vanilla-extract/vite-plugin');
  const integration = packageDir('@vanilla-extract/integration', [plugin]);
  const veCss = extra.alias?.['@vanilla-extract/css'] ?? packageDir('@vanilla-extract/css', [...resolveFrom, ...(integration ? [integration] : [])]) ?? need('@vanilla-extract/css');
  const allow = [root, ui.dir, ...(extra.allow ?? [])];
  return {
    root,
    base: './',
    plugins: [
      // vanilla-extract compiles .css.ts on a Vite server of its own that keeps our plugins but not
      // our server options: this plugin lets that server, too, read the adapter's sources.
      { name: 'pxsig-allow-design-system', config: () => ({ server: { fs: { allow } } }) },
      react(),
      vanillaExtractPlugin({ unstable_pluginFilter: ({ name }) => name === 'pxsig-allow-design-system' || name === 'vite-tsconfig-paths' }),
    ],
    logLevel: 'warn',
    resolve: {
      alias: {
        '@ui-adapter': ui.file,
        '@ui': path.join(root, 'src/ui/index.ts'),
        ...extra.alias,
        '@vanilla-extract/css': veCss,
        // One React: ours (or the consumer's), never a second copy from the adapter's design system.
        react: need('react'),
        'react-dom': need('react-dom'),
      },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: { exclude: extra.optimizeDepsExclude ?? ['@vanilla-extract/css', '@vanilla-extract/css/fileScope'] },
    build: {
      outDir,
      emptyOutDir: true,
      chunkSizeWarningLimit: 4000,
      modulePreload: false,
      rollupOptions: { output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'assets/app.js', assetFileNames: 'assets/[name][extname]' } },
    },
  };
}
