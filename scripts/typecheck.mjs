#!/usr/bin/env node
/**
 * typecheck.mjs — `pnpm typecheck`: tsc --noEmit over the dashboard (contract, runtime, fallbacks,
 * views, inspector, diff viewer), its test harness and the plain example adapter (tsconfig.json).
 *
 * Then the JavaScript (pxsig, the Storybook addon, scripts, tools): scripts/check-types.mjs, whose
 * error count per file may only go down (scripts/type-errors-baseline.json).
 *
 * With PXSIG_DS_SOURCE set (a checkout of the reference adapter's design system), it also checks
 * the reference adapter against that design system's sources and React types; without it, that
 * step is skipped and says so (CI has no checkout).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagesIn } from '../packages/dashboard/src/ui/adapters/hydrotik/vite.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const tsc = createRequire(path.join(repo, 'package.json')).resolve('typescript/bin/tsc');
/** @param {string} project */
const run = (project) =>
  spawnSync(process.execPath, [tsc, '-p', project], { cwd: repo, stdio: 'inherit' }).status ?? 1;

let status = run('tsconfig.json');
console.log(
  status
    ? '[typecheck] dashboard: errors above'
    : '[typecheck] dashboard, test harness, plain example adapter: ok'
);

const source = process.env.PXSIG_DS_SOURCE;
if (!source)
  console.log(
    '[typecheck] reference adapter: skipped (set PXSIG_DS_SOURCE to check it against its design system)'
  );
else {
  const pkgs = packagesIn(source);
  /** @param {string} name */
  const need = (name) =>
    pkgs[name] ??
    (() => {
      throw new Error(`[typecheck] ${name} not found in ${source}`);
    })();
  const ds = need('@hydrotik/design-system');
  // One copy of React's types: the design system's, so its components and the adapter agree.
  const types = [
    path.join(source, 'node_modules', '@types'),
    path.join(ds, 'node_modules', '@types'),
  ].find((d) => existsSync(path.join(d, 'react')));
  const cfgDir = path.join(repo, 'node_modules', '.cache', 'pxsig-typecheck');
  mkdirSync(cfgDir, { recursive: true });
  /** @param {string} p */
  const rel = (p) => path.relative(cfgDir, p).split(path.sep).join('/');
  const config = {
    extends: rel(path.join(repo, 'tsconfig.json')),
    compilerOptions: {
      baseUrl: rel(repo),
      paths: {
        '@ui': ['packages/dashboard/src/ui/index.ts'],
        'pxsig/dashboard': ['packages/dashboard/src/ui/contract.ts'],
        '@hydrotik/design-system/chart': [path.join(ds, 'src/chart.ts')],
        '@hydrotik/design-system/fonts': [path.join(ds, 'src/fonts.ts')],
        '@hydrotik/design-system/styles': [path.join(ds, 'src/styles.ts')],
        '@hydrotik/design-system': [path.join(ds, 'src/index.ts')],
        '@hydrotik/tokens': [path.join(need('@hydrotik/tokens'), 'src/index.ts')],
        '@hydrotik/theme-provider': [path.join(need('@hydrotik/theme-provider'), 'src/index.ts')],
        recharts: [path.join(ds, 'node_modules', 'recharts')],
        ...(types
          ? Object.fromEntries(
              ['react', 'react-dom'].flatMap((n) => [
                [n, [realpathSync(path.join(types, n))]],
                [`${n}/*`, [`${realpathSync(path.join(types, n))}/*`]],
              ])
            )
          : {}),
      },
    },
    include: [
      rel(path.join(repo, 'packages/dashboard/src/ui/adapters/hydrotik')),
      rel(path.join(repo, 'types')),
    ],
    exclude: [],
  };
  const file = path.join(cfgDir, 'tsconfig.hydrotik.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  const s = run(file);
  console.log(
    s ? '[typecheck] reference adapter: errors above' : '[typecheck] reference adapter: ok'
  );
  status ||= s;
}
const js = spawnSync(process.execPath, [path.join(repo, 'scripts', 'check-types.mjs')], {
  cwd: repo,
  stdio: 'inherit',
}).status;
status ||= js ?? 1;
process.exit(status);
