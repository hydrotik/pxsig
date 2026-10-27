/**
 * dashboard.mjs — `pxsig dashboard build | gaps`: the dashboard rebuilt on a project's own design
 * system, through a UI adapter (docs/ui/build-adapter.md).
 *
 *   pxsig dashboard gaps  [--ui <path>] [--json]   the adapter's coverage of the UI contract
 *   pxsig dashboard build [--ui <path>] [--out <dir>]
 *   pxsig dashboard check [--ui <path>] [--build <dir>] [--out <dir>] [--themes dark,light] [--strict]
 *                                                  every feature's screens on that build (dashboard-check.mjs)
 *
 * --ui defaults to `dashboard.ui` in the current folder's pxsig.config.json. The dashboard's source
 * ships in this package (`dashboard/`, or `../dashboard` in a source checkout); the build runs Vite
 * from the current project, which needs vite, @vitejs/plugin-react, @vanilla-extract/vite-plugin,
 * react and react-dom installed. The default output (node_modules/.cache/pxsig/dashboard, with a
 * pxsig-build.json stamp) is what `pxsig serve` serves while it is current (lib/dashboard-dir.mjs);
 * the prebuilt dashboard in dist/ is untouched.
 *
 * Both compare the adapter's contract version (conformance.json `contract`) with this pxsig's
 * (docs/ui/contract-changes.md): an older minor builds, naming what falls back; an older major is a
 * `gaps` problem and `build` refuses, with the migration notes; a newer one is a note.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildDirFor, STAMP } from './lib/dashboard-dir.mjs';
import { PXSIG_VERSION } from './lib/workspace.mjs';
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
  const { contractStatus, readConformance } = await load(src, 'ui-tools.mjs');
  const contract = contractStatus(readConformance(ui.dir)?.contract ?? '1.0.0');
  if (contract.status === 'older-major') throw new Error([`the "${ui.name}" adapter is ${contract.line}.`, ...(contract.notes ?? [])].join('\n\n'));
  if (contract.status !== 'same') log(`[dashboard] the "${ui.name}" adapter is ${contract.line}`);
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
  // The default folder is where `pxsig serve` looks for this project's build.
  const outDir = typeof flags.out === 'string' ? resolve(cwd, flags.out) : buildDirFor(cwd);
  log(`[dashboard] building with the "${ui.name}" adapter (${relative(cwd, ui.file) || ui.file}) into ${relative(cwd, outDir) || outDir}`);
  const config = await dashboardConfig({ adapter: ui.file, cwd, outDir, resolveFrom: [cwd], react, vanillaExtractPlugin, root: src });
  await vite.build({ ...config, configFile: false });
  classicScript(outDir);
  // What serve compares: this pxsig's version and when the build ran (against the adapter's edits).
  writeFileSync(join(outDir, STAMP), `${JSON.stringify({ adapter: ui.file, pxsig: PXSIG_VERSION, contract: contract.current, adapterContract: contract.adapter, builtAt: Date.now() }, null, 2)}\n`);
  return { outDir, adapter: ui.name, fromConfig: ui.from === 'pxsig.config.json dashboard.ui' };
}

/** The CLI entry: `pxsig dashboard <build | gaps>`. Returns an exit code. */
export async function dashboardCommand(sub, flags, { emit = (s) => process.stdout.write(`${s}\n`) } = {}) {
  if (sub === 'gaps') {
    const { report, text } = await gaps(flags);
    emit(flags.json ? JSON.stringify(report, null, 2) : text);
    return report.problems.length ? 1 : 0;
  }
  if (sub === 'build') {
    const { outDir, fromConfig } = await build(flags);
    const usual = !flags.out && fromConfig;
    emit(flags.json ? JSON.stringify({ outDir }) : `built ${outDir}\n${usual ? 'pxsig serve serves it from now on, while it is newer than the adapter' : `serve it: PXSIG_DASHBOARD_DIR=${outDir} pxsig serve`}`);
    return 0;
  }
  if (sub === 'check') {
    const { CheckSetupError, dashboardCheck } = await import('./dashboard-check.mjs');
    try {
      const { code, report, outDir } = await dashboardCheck(flags);
      const s = report.summary;
      emit(
        flags.json
          ? JSON.stringify(report, null, 2)
          : [
              `${s.rendered} of ${s.screens} screens rendered${s.failed ? `, ${s.failed} failed` : ''} · ${s.withAxe} with axe violations${report.strict ? '' : ' (advisory; --strict makes them fail)'}`,
              ...report.screens.filter((x) => !x.rendered).map((x) => `  failed: ${x.feature} #${x.index + 1} (${x.theme}): ${x.reason}`),
              report.reference.used ? null : `no reference column: ${report.reference.note}`,
              `gallery: ${join(outDir, 'index.html')}`,
            ]
              .filter(Boolean)
              .join('\n')
      );
      return code;
    } catch (e) {
      if (e instanceof CheckSetupError) {
        process.stderr.write(`[dashboard] setup error: ${e.message}\n`);
        return 2;
      }
      throw e;
    }
  }
  throw new Error('usage: pxsig dashboard build [--ui <path>] [--out <dir>] | pxsig dashboard gaps [--ui <path>] [--json] | pxsig dashboard check [--build <dir>] [--out <dir>] [--themes dark,light] [--strict]');
}
