#!/usr/bin/env node
/**
 * typecheck.mjs — `pnpm typecheck`: tsc --noEmit over the dashboard (contract, runtime, fallbacks,
 * views, inspector, diff viewer, the reference adapter), its test harness and the plain example
 * adapter (tsconfig.json). The reference adapter is checked against the committed declarations of
 * the design-system names it imports (adapters/hydrotik/design-system.d.ts, `ui.mjs types`).
 *
 * Then the JavaScript (pxsig, the Storybook addon, scripts, tools): scripts/check-types.mjs, whose
 * error count per file may only go down (scripts/type-errors-baseline.json).
 *
 * With a design-system source configured (PXSIG_DS_SOURCE or `git config pxsig.dsSource`, as
 * `pnpm ds:fetch` reads them), or the pinned checkout already in place, it also checks the
 * reference adapter against the design system at the commit design-system.json pins (the checkout
 * ds:fetch makes, target/design-system or PXSIG_DS_DIR, fetched first when missing or stale): its
 * sources, its React types, and that the committed declarations match a fresh `ui.mjs types` of
 * it, which needs that checkout built. The source is only where the pin is fetched from, never what
 * is checked, so a checkout at another commit cannot pass or fail the check. Without either, that
 * step is skipped and says so (CI has no source).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagesIn } from '../packages/dashboard/src/ui/adapters/hydrotik/vite.mjs';
import {
  DsFetchError,
  dsDir,
  dsSource,
  ensureDesignSystem,
  isCurrent,
  readPin,
} from './ds-fetch.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const tsPkg = createRequire(path.join(repo, 'package.json')).resolve('typescript/package.json');
const tsc = path.join(
  path.dirname(tsPkg),
  /** @type {{ bin: { tsc: string } }} */ (JSON.parse(readFileSync(tsPkg, 'utf8'))).bin.tsc
);
/** @param {string} project */
const run = (project) =>
  spawnSync(process.execPath, [tsc, '-p', project], { cwd: repo, stdio: 'inherit' }).status ?? 1;

let status = run('tsconfig.json');
console.log(
  status
    ? '[typecheck] dashboard: errors above'
    : '[typecheck] dashboard, reference adapter (committed declarations), test harness, plain example adapter: ok'
);

/**
 * The pinned design-system checkout, fetched when a source is configured; null when there is
 * neither a source nor a current checkout.
 * @returns {string | null}
 */
function pinnedCheckout() {
  if (!dsSource({ repo }) && !isCurrent(repo, readPin(repo))) return null;
  try {
    return ensureDesignSystem({ repo });
  } catch (e) {
    if (!(e instanceof DsFetchError)) throw e;
    console.error(e.message);
    process.exit(1);
  }
}

const source = pinnedCheckout();
if (!source)
  console.log(
    '[typecheck] reference adapter against its design system: skipped (no design-system source: git config pxsig.dsSource or PXSIG_DS_SOURCE, then pnpm ds:fetch)'
  );
else {
  console.log(
    `[typecheck] reference adapter against the design system at the pin (${path.relative(repo, dsDir(repo)).split(path.sep).join('/')})`
  );
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
      paths: {
        '@ui': [rel(path.join(repo, 'packages/dashboard/src/ui/index.ts'))],
        'pxsig/dashboard': [rel(path.join(repo, 'packages/dashboard/src/ui/contract.ts'))],
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
    // The design system itself stands in for its committed declarations here.
    exclude: [
      rel(path.join(repo, 'packages/dashboard/src/ui/adapters/hydrotik/design-system.d.ts')),
    ],
  };
  const file = path.join(cfgDir, 'tsconfig.hydrotik.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  const s = run(file);
  console.log(
    s ? '[typecheck] reference adapter: errors above' : '[typecheck] reference adapter: ok'
  );
  status ||= s;
  const fresh = spawnSync(
    process.execPath,
    [path.join(repo, 'scripts', 'ui.mjs'), 'types', '--check'],
    // ui.mjs reads the checkout from PXSIG_DS_SOURCE: the pinned one, not the configured source.
    { cwd: repo, stdio: 'inherit', env: { ...process.env, PXSIG_DS_SOURCE: source } }
  ).status;
  status ||= fresh ?? 1;
  if (fresh && !existsSync(path.join(ds, 'dist', 'index.d.mts')))
    console.error(
      `[typecheck] the declarations are generated from a built checkout: run \`pnpm turbo run build --filter=@hydrotik/design-system\` in ${path.relative(repo, source).split(path.sep).join('/')}, then pnpm typecheck again`
    );
}
const js = spawnSync(process.execPath, [path.join(repo, 'scripts', 'check-types.mjs')], {
  cwd: repo,
  stdio: 'inherit',
}).status;
status ||= js ?? 1;
process.exit(status);
