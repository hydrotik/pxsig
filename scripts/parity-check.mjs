#!/usr/bin/env node
/**
 * parity-check.mjs — `pxsig dashboard parity` on this repository's reference adapter, as the screens
 * workflow runs it: the parity page built here with this checkout's own Vite (packages/dashboard),
 * then the command run on it, in pxsig's image with `--container` (docker/screens-image.json), as
 * pxsig's own screens are rendered.
 *
 *   node scripts/parity-check.mjs --storybook <dir> [--ui <adapter>] [--out <dir>] [--themes dark,light] [--container]
 *
 * --storybook   the design system's built Storybook, inside this checkout (the container sees it)
 * --ui          the adapter (default: the one the dashboard build would use)
 * --out         default target/parity: report.json, summary.md, shots/, and the page in page/
 *
 * Exit: `pxsig dashboard parity`'s (0 match · 1 a difference or a pair that did not render · 2
 * setup), or 2 when Docker fails.
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');

/** @param {string[]} args @param {string} name */
const flag = (args, name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const args = process.argv.slice(2);
  const storybook = flag(args, 'storybook');
  if (!storybook) {
    console.error('[parity] usage: node scripts/parity-check.mjs --storybook <dir> [--container]');
    process.exit(2);
  }
  const out = resolve(flag(args, 'out') ?? join(repo, 'target', 'parity'));
  const { resolveAdapter } = await import('../packages/dashboard/build-config.mjs');
  const ui = resolveAdapter({ adapter: flag(args, 'ui'), cwd: repo });
  const page = join(out, 'page');
  rmSync(page, { recursive: true, force: true });
  const { buildParityPage } = await import('../packages/dashboard/parity-page.mjs');
  await buildParityPage({ adapter: ui.file, cwd: repo, outDir: page });
  console.log(`[parity] built the parity page with the ${ui.name} adapter`);
  // The adapter by its folder: the container sees neither PXSIG_UI_ADAPTER nor a config, and the
  // checkout is mounted at its own path there.
  const rest = [
    'dashboard',
    'parity',
    '--storybook',
    resolve(storybook),
    '--ui',
    ui.dir,
    '--build',
    page,
    '--out',
    out,
    '--themes',
    flag(args, 'themes') ?? 'dark,light',
  ];
  const bin = 'packages/pxsig/bin/pxsig.mjs';
  if (args.includes('--container')) {
    const { dockerArgs, pinnedImage } = await import('./screens-container.mjs');
    const user =
      process.getuid && process.getgid ? `${process.getuid()}:${process.getgid()}` : null;
    const r = spawnSync(
      'docker',
      dockerArgs({ image: pinnedImage(repo), repo, user, args: rest, script: bin }),
      { stdio: 'inherit' }
    );
    if (r.error || r.status === null || r.status >= 125) {
      console.error(`[parity] docker: ${r.error?.message ?? `exit ${r.status}`}`);
      process.exit(2);
    }
    process.exit(r.status);
  }
  const r = spawnSync(process.execPath, [join(repo, bin), ...rest], {
    stdio: 'inherit',
    cwd: repo,
  });
  process.exit(r.status ?? 2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
