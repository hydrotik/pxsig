/**
 * dashboard.mjs — `pxsig dashboard build | gaps`: the dashboard rebuilt on a project's own design
 * system, through a UI adapter (docs/ui/build-adapter.md).
 *
 *   pxsig dashboard gaps  [--ui <path>] [--json]   the adapter's coverage of the UI contract
 *   pxsig dashboard build [--ui <path>] [--out <dir>]
 *
 * --ui defaults to `dashboard.ui` in the current folder's pxsig.config.json. The dashboard's source
 * ships in this package (`dashboard/`, or `../dashboard` in a source checkout); the build runs Vite
 * from the current project, which needs vite, @vitejs/plugin-react, @vanilla-extract/vite-plugin,
 * react and react-dom installed. The prebuilt dashboard in dist/ is untouched: serve the new one with
 * PXSIG_DASHBOARD_DIR=<out>.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NEEDS = ['vite', '@vitejs/plugin-react', '@vanilla-extract/vite-plugin', 'react', 'react-dom'];

/** The dashboard source shipped in this package, or the sibling folder in a source checkout. */
export function dashboardSource() {
  // Installed: the copy packed into this package. In a source checkout: the live sources beside it.
  const installed = pkg.split(sep).includes('node_modules');
  for (const dir of installed ? [join(pkg, 'dashboard')] : [join(pkg, '..', 'dashboard'), join(pkg, 'dashboard')]) if (existsSync(join(dir, 'build-config.mjs')) && existsSync(join(dir, 'src', 'ui', 'contract.ts'))) return dir;
  throw new Error('the dashboard source is not in this pxsig package (expected dashboard/ beside src/)');
}

const load = (dir, file) => import(pathToFileURL(join(dir, file)).href);

/** The adapter in force (--ui, else dashboard.ui in ./pxsig.config.json); a name or a path. */
async function adapterOf(flags, cwd) {
  const { resolveAdapter } = await load(dashboardSource(), 'build-config.mjs');
  return resolveAdapter({ adapter: typeof flags.ui === 'string' ? flags.ui : undefined, cwd });
}

export async function gaps(flags, cwd = process.cwd()) {
  const src = dashboardSource();
  const ui = await adapterOf(flags, cwd);
  const { buildManifest, gapsOf, gapsText } = await load(src, 'ui-tools.mjs');
  const report = gapsOf({ adapterFile: ui.file, manifest: buildManifest() });
  return { report, text: gapsText(report) };
}

export async function build(flags, cwd = process.cwd(), log = (m) => process.stderr.write(`${m}\n`)) {
  const src = dashboardSource();
  const ui = await adapterOf(flags, cwd);
  const { dashboardConfig, packageDir } = await load(src, 'build-config.mjs');
  const missing = NEEDS.filter((n) => !packageDir(n, [cwd]));
  if (missing.length) throw new Error(`pxsig dashboard build runs Vite from this project and needs: ${missing.join(', ')}. Install them as devDependencies (e.g. pnpm add -D ${missing.join(' ')}).`);
  // The package's ESM entry (its `import` export), so Vite's CJS shim and its warning stay out.
  const imp = (n) => {
    const dir = packageDir(n, [cwd]);
    const { exports: ex, module: mod, main } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const pick = (e) => (typeof e === 'string' ? e : e && (pick(e.import) ?? pick(e.default) ?? pick(e.node)));
    const entry = pick(ex?.['.'] ?? (typeof ex === 'string' ? ex : null)) ?? mod ?? main ?? 'index.js';
    return import(pathToFileURL(join(dir, entry)).href);
  };
  const vite = await imp('vite');
  const react = (await imp('@vitejs/plugin-react')).default;
  const { vanillaExtractPlugin } = await imp('@vanilla-extract/vite-plugin');
  const { classicScript } = await load(src, 'postbuild.mjs');
  const outDir = resolve(cwd, typeof flags.out === 'string' ? flags.out : 'node_modules/.cache/pxsig/dashboard');
  log(`[dashboard] building with the "${ui.name}" adapter (${relative(cwd, ui.file) || ui.file}) into ${relative(cwd, outDir) || outDir}`);
  const config = await dashboardConfig({ adapter: ui.file, cwd, outDir, resolveFrom: [cwd], react, vanillaExtractPlugin, root: src });
  await vite.build({ ...config, configFile: false });
  classicScript(outDir);
  return { outDir, adapter: ui.name };
}

/** The CLI entry: `pxsig dashboard <build | gaps>`. Returns an exit code. */
export async function dashboardCommand(sub, flags, { emit = (s) => process.stdout.write(`${s}\n`) } = {}) {
  if (sub === 'gaps') {
    const { report, text } = await gaps(flags);
    emit(flags.json ? JSON.stringify(report, null, 2) : text);
    return report.problems.length ? 1 : 0;
  }
  if (sub === 'build') {
    const { outDir } = await build(flags);
    emit(flags.json ? JSON.stringify({ outDir }) : `built ${outDir}\nserve it: PXSIG_DASHBOARD_DIR=${outDir} pxsig serve`);
    return 0;
  }
  throw new Error('usage: pxsig dashboard build [--ui <path>] [--out <dir>] | pxsig dashboard gaps [--ui <path>] [--json]');
}
