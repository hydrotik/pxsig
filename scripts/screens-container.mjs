#!/usr/bin/env node
/**
 * screens-container.mjs — runs scripts/screens-check.mjs in pxsig's container, the image pinned in
 * docker/screens-image.json, so pxsig's own baselines are rendered the same way on every machine.
 *
 *   pnpm screens:check [--build <dir>] [--only <feature,…>]
 *
 * The checkout is mounted at its own path (pnpm's links stay valid) and the check runs as the
 * calling user, so what it writes in packages/dashboard/.pxsig belongs to them. The image's engine
 * and Playwright are used (PXSIG_BIN, PXSIG_PLAYWRIGHT), the checkout's pxsig sources and
 * dependencies (`pnpm install` first). Needs Docker. Exit: screens-check's, or 2 when Docker fails.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The pinned image, as docker/screens-image.json names it. */
export function pinnedImage(/** @type {string} */ repo) {
  const { image } = /** @type {{ image?: unknown }} */ (
    JSON.parse(readFileSync(join(repo, 'docker', 'screens-image.json'), 'utf8'))
  );
  if (
    typeof image !== 'string' ||
    !/^ghcr\.io\/hydrotik\/pxsig:[^@\s]+@sha256:[0-9a-f]{64}$/.test(image)
  )
    throw new Error(
      'docker/screens-image.json: image must be ghcr.io/hydrotik/pxsig:<tag>@sha256:<digest>'
    );
  return image;
}

/**
 * The `docker run` arguments.
 * @param {{ image: string, repo: string, user: string | null, args: string[] }} o
 *   user `uid:gid`, or null where there is none (Windows)
 */
export function dockerArgs({ image, repo, user, args }) {
  return [
    'run',
    '--rm',
    '--init',
    '--ipc=host',
    ...(user ? ['--user', user] : []),
    '-e',
    'HOME=/tmp',
    '-e',
    'CI',
    '-v',
    `${repo}:${repo}`,
    '-w',
    repo,
    image,
    'node',
    'scripts/screens-check.mjs',
    ...args,
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
  const user = process.getuid && process.getgid ? `${process.getuid()}:${process.getgid()}` : null;
  const r = spawnSync(
    'docker',
    dockerArgs({ image: pinnedImage(repo), repo, user, args: process.argv.slice(2) }),
    { stdio: 'inherit' }
  );
  if (r.error) {
    console.error(`[screens] docker: ${r.error.message}`);
    process.exit(2);
  }
  // 125–127: Docker itself failed (no daemon, no image), not the check.
  process.exit(r.status === null || r.status >= 125 ? 2 : r.status);
}
