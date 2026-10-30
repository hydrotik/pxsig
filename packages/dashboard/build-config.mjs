/// <reference types="node" />
/**
 * The dashboard's Vite config, shared by this repository's build (vite.config.mjs) and by
 * `pxsig dashboard build` in a consumer project. The caller passes the plugins and where to resolve
 * React from, so nothing here imports a build tool by itself.
 *
 * The UI adapter is chosen once, at build time:
 *   1. `adapter` (the `--ui` flag), else PXSIG_UI_ADAPTER, else `dashboard.ui` in the
 *      pxsig.config.json of the working folder, else `hydrotik` when PXSIG_DS_SOURCE is set (the
 *      reference look, built from a checkout of its design system), else `plain`, which builds
 *      anywhere (semantic HTML and one stylesheet);
 *   2. a bare name (`plain`, `hydrotik`) is a built-in adapter under src/ui/adapters/<name>/; anything else
 *      is a path to an adapter module (a file, or a folder with an index.tsx / .ts / .jsx / .js);
 *   3. anything else fails the build at once, naming what it looked for.
 * Vite aliases `@ui-adapter` to the module. An adapter folder may carry a `vite.mjs` whose default
 * export returns build settings (aliases, folders to allow) for its design system.
 *
 * @typedef {{ adapter?: string, cwd?: string }} AdapterOptions
 * @typedef {{ name: string, file: string, dir: string, from: string }} ResolvedAdapter
 * @typedef {{ alias?: Record<string, string>, allow?: string[], dedupe?: string[], optimizeDepsExclude?: string[] }} AdapterBuildSettings
 *   what an adapter folder's `vite.mjs` default export returns
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const builtins = path.join(here, 'src/ui/adapters');
const INDEX = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];

export const builtinAdapters = () =>
  existsSync(builtins)
    ? readdirSync(builtins, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];

/**
 * The adapter spec in force, and which rule picked it (`from`, reported by the build and
 * `pxsig dashboard gaps`). The two defaults' `from` both start with "default".
 * @param {AdapterOptions} [opts]
 * @returns {{ spec: string, base: string, from: string }}
 */
export function adapterSpec({ adapter, cwd = process.cwd() } = {}) {
  if (adapter) return { spec: adapter, base: cwd, from: '--ui' };
  if (process.env.PXSIG_UI_ADAPTER)
    return { spec: process.env.PXSIG_UI_ADAPTER, base: cwd, from: 'PXSIG_UI_ADAPTER' };
  const cfg = path.join(cwd, 'pxsig.config.json');
  if (existsSync(cfg)) {
    try {
      // pxsig.config.json as JSON; `dashboard.ui` is the adapter spec when set (a string).
      const ui = /** @type {{ dashboard?: { ui?: string } } | null} */ (
        JSON.parse(readFileSync(cfg, 'utf8'))
      )?.dashboard?.ui;
      if (ui) return { spec: ui, base: cwd, from: 'pxsig.config.json dashboard.ui' };
    } catch {
      // an unreadable config is reported by the commands that read it
    }
  }
  if (process.env.PXSIG_DS_SOURCE)
    return { spec: 'hydrotik', base: cwd, from: 'default (PXSIG_DS_SOURCE is set)' };
  return { spec: 'plain', base: cwd, from: 'default' };
}

/**
 * The adapter's module file and folder, or an error that says what was looked for.
 * @param {AdapterOptions} [opts]
 * @returns {ResolvedAdapter}
 */
export function resolveAdapter(opts = {}) {
  const { spec, base, from } = adapterSpec(opts);
  const known = builtinAdapters();
  if (/^[a-z0-9][a-z0-9-]*$/.test(spec)) {
    if (!known.includes(spec))
      throw new Error(
        `[pxsig ui] unknown UI adapter "${spec}" (from ${from}). Built-in adapters: ${known.join(', ') || 'none'}; or pass a path to an adapter module.`
      );
    const dir = path.join(builtins, spec);
    const file = INDEX.map((f) => path.join(dir, f)).find(existsSync);
    if (!file)
      throw new Error(`[pxsig ui] the built-in adapter "${spec}" has no index file in ${dir}`);
    return { name: spec, file, dir, from };
  }
  const p = path.resolve(base, spec);
  /** @type {string | null | undefined} */
  let file = null;
  if (existsSync(p) && statSync(p).isDirectory())
    file = INDEX.map((f) => path.join(p, f)).find(existsSync) ?? null;
  else if (existsSync(p)) file = p;
  else file = ['.tsx', '.ts', '.jsx', '.js'].map((e) => p + e).find(existsSync) ?? null;
  if (!file)
    throw new Error(
      `[pxsig ui] no UI adapter at "${spec}" (from ${from}; looked for ${p} and ${p}/index.{tsx,ts,jsx,js}). Built-in adapters: ${known.join(', ') || 'none'}.`
    );
  return {
    name: path.basename(
      statSync(p, { throwIfNoEntry: false })?.isDirectory() ? p : path.dirname(file)
    ),
    file,
    dir: path.dirname(file),
    from,
  };
}

/**
 * A package's folder, from the first of `fromDirs` that reaches it: node_modules/<name> in the
 * folder or a parent (what Node's resolution walks; works when a package's exports hide its
 * package.json).
 * @param {string} name
 * @param {string[]} fromDirs
 * @returns {string | null}
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
 * `o.resolveFrom` lists the folders to resolve react, react-dom and the vanilla-extract css package
 * from; `o.react` is the default export of the Vite React plugin (`\@vitejs/plugin-react`), and
 * `o.vanillaExtractPlugin` the vanilla-extract Vite plugin.
 * @param {object} o
 * @param {string} [o.adapter]       --ui: a built-in name or a path
 * @param {string} [o.cwd]           where pxsig.config.json and relative paths are read
 * @param {string} o.outDir
 * @param {string[]} o.resolveFrom
 * @param {() => unknown} o.react
 * @param {(options: { unstable_pluginFilter: (plugin: { name: string }) => boolean }) => unknown} o.vanillaExtractPlugin
 * @param {string} [o.root]          the dashboard source folder (default: this one)
 * @param {boolean} [o.minify]       minify the bundle; default false (readable output that a reviewer
 *                                   can audit), true when PXSIG_DASHBOARD_MINIFY=1
 * @param {string} [o.viteVersion]   the `version` the caller's vite exports; from 8 (Rolldown) an IIFE
 *                                   is one chunk already, so `inlineDynamicImports` is left out
 */
export async function dashboardConfig({
  adapter,
  cwd,
  outDir,
  resolveFrom,
  react,
  vanillaExtractPlugin,
  root = here,
  minify = process.env.PXSIG_DASHBOARD_MINIFY === '1',
  viteVersion,
}) {
  const ui = resolveAdapter({ adapter, cwd });
  const extraFile = path.join(ui.dir, 'vite.mjs');
  /** @type {AdapterBuildSettings} */
  const extra = existsSync(extraFile)
    ? // An adapter's vite.mjs: its default export returns these settings (this file's header).
      await /** @type {{ default: () => AdapterBuildSettings | Promise<AdapterBuildSettings> }} */ (
          await import(pathToFileURL(extraFile).href)
      ).default()
    : {};
  /** @param {string} name @param {string[]} [from] @returns {string} */
  const need = (name, from = resolveFrom) =>
    packageDir(name, from) ??
    (() => {
      throw new Error(`[pxsig ui] cannot resolve ${name} from ${from.join(', ')}: install it`);
    })();
  // @vanilla-extract/css: the adapter's copy if it pins one, else the one the plugin compiles with.
  const plugin = need('@vanilla-extract/vite-plugin');
  const integration = packageDir('@vanilla-extract/integration', [plugin]);
  const veCss =
    extra.alias?.['@vanilla-extract/css'] ??
    packageDir('@vanilla-extract/css', [...resolveFrom, ...(integration ? [integration] : [])]) ??
    need('@vanilla-extract/css');
  const allow = [root, ui.dir, ...(extra.allow ?? [])];
  // The contract version the adapter was written for: icons added since are drawn as their defaults.
  let contract = '1.0.0';
  try {
    contract =
      // conformance.json as JSON: `contract` is the version string the adapter was written for.
      /** @type {{ contract?: string }} */ (
        JSON.parse(readFileSync(path.join(ui.dir, 'conformance.json'), 'utf8'))
      ).contract ?? contract;
  } catch {
    // no conformance.json: `pxsig dashboard gaps` reports it; the build treats the adapter as 1.0.0
  }
  return {
    root,
    base: './',
    plugins: [
      // vanilla-extract compiles .css.ts on a Vite server of its own that keeps our plugins but not
      // our server options: this plugin lets that server, too, read the adapter's sources.
      { name: 'pxsig-allow-design-system', config: () => ({ server: { fs: { allow } } }) },
      react(),
      vanillaExtractPlugin({
        unstable_pluginFilter: ({ name }) =>
          name === 'pxsig-allow-design-system' || name === 'vite-tsconfig-paths',
      }),
    ],
    logLevel: 'warn',
    define: { __PXSIG_ADAPTER_CONTRACT__: JSON.stringify(contract) },
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
    optimizeDeps: {
      exclude: extra.optimizeDepsExclude ?? [
        '@vanilla-extract/css',
        '@vanilla-extract/css/fileScope',
      ],
    },
    build: {
      outDir,
      emptyOutDir: true,
      // Unminified by default, so the bundle that ships in the npm package reads as code. When on,
      // each vite's own minifier: esbuild up to 7, Oxc from 8 (where esbuild is an optional peer).
      minify,
      chunkSizeWarningLimit: 4000,
      modulePreload: false,
      rollupOptions: {
        output: {
          format: 'iife',
          ...(Number(viteVersion?.split('.')[0]) >= 8 ? {} : { inlineDynamicImports: true }),
          entryFileNames: 'assets/app.js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
  };
}
