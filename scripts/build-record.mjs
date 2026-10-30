#!/usr/bin/env node
/**
 * build-record.mjs — writes `BUILD.json` beside a built dashboard: how the bundle that ships in
 * the pxsig package was built. The dashboard's `build` script runs it after Vite.
 *
 *   node scripts/build-record.mjs [<dashboard dir>]
 *
 * The folder defaults to PXSIG_DASHBOARD_OUT, else packages/pxsig/dist/dashboard. The record:
 *   adapter       the UI adapter's name (build-config.mjs chooses it the same way as the build)
 *   designSystem  for PXSIG_DS_SOURCE when it is the top of a git checkout: its commit, whether
 *                 the working tree had changes, and its pnpm-lock.yaml's sha256; otherwise null
 *   lockSha256    this repository's pnpm-lock.yaml sha256
 *   node          the Node version that ran the build
 *   builtAt       SOURCE_DATE_EPOCH when set, else now (ISO 8601, UTC)
 *   bundled       the third-party packages in the bundle: name, version, licence
 *                 (scripts/bundle-sbom.mjs, which reads it back for the release SBOM)
 * No path, URL or user name is recorded. Exit 1 on a failure.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveAdapter } from '../packages/dashboard/build-config.mjs';
import { dashboardPackages } from './bundle-sbom.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));

/** @param {string} file @returns {string | null} */
export const sha256File = (file) =>
  existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;

/**
 * A folder's git commit and whether its working tree has changes, or null when the folder is not
 * the top of a git checkout (or git is not installed).
 * @param {string} dir
 * @returns {{ commit: string, dirty: boolean } | null}
 */
export function gitState(dir) {
  /** @param {string[]} args */
  const git = (...args) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  try {
    if (realpathSync(git('rev-parse', '--show-toplevel')) !== realpathSync(dir)) return null;
    return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
  } catch {
    return null;
  }
}

/**
 * The record for a dashboard built into `outDir`.
 * @param {object} o
 * @param {string} o.outDir
 * @param {string} o.adapter            the adapter's name
 * @param {string} [o.dsSource]         PXSIG_DS_SOURCE
 * @param {string} [o.lockFile]         this repository's pnpm-lock.yaml
 * @param {string} [o.sourceDateEpoch]  SOURCE_DATE_EPOCH (seconds)
 * @param {string} [o.base]             the folder the build ran in (module paths are relative to it)
 */
export function buildRecord({
  outDir,
  adapter,
  dsSource,
  lockFile = join(repo, 'pnpm-lock.yaml'),
  sourceDateEpoch,
  base,
}) {
  const ds = dsSource && existsSync(dsSource) ? gitState(dsSource) : null;
  const when = sourceDateEpoch ? new Date(Number(sourceDateEpoch) * 1000) : new Date();
  return {
    adapter,
    designSystem:
      ds && dsSource ? { ...ds, lockSha256: sha256File(join(dsSource, 'pnpm-lock.yaml')) } : null,
    lockSha256: sha256File(lockFile),
    node: process.version,
    builtAt: when.toISOString(),
    bundled: dashboardPackages(outDir, base).packages.map(({ name, version, license }) => ({
      name,
      version,
      license: license ?? null,
    })),
  };
}

/**
 * The record as JSON, one `bundled` entry per line.
 * @param {ReturnType<typeof buildRecord>} record
 */
export const format = (record) =>
  `${JSON.stringify({ ...record, bundled: [] }, null, 2).replace(
    '"bundled": []',
    `"bundled": [\n${record.bundled.map((b) => `    ${JSON.stringify(b)}`).join(',\n')}\n  ]`
  )}\n`;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outDir = resolve(
    process.argv[2] ??
      process.env.PXSIG_DASHBOARD_OUT ??
      join(repo, 'packages', 'pxsig', 'dist', 'dashboard')
  );
  try {
    const record = buildRecord({
      outDir,
      adapter: resolveAdapter({ cwd: process.env.INIT_CWD ?? process.cwd() }).name,
      dsSource: process.env.PXSIG_DS_SOURCE,
      sourceDateEpoch: process.env.SOURCE_DATE_EPOCH,
    });
    writeFileSync(join(outDir, 'BUILD.json'), format(record));
    const ds = record.designSystem;
    console.log(
      `[build-record] BUILD.json: adapter ${record.adapter}, ${record.bundled.length} bundled packages` +
        (ds ? `, design system ${ds.commit}${ds.dirty ? ' (with uncommitted changes)' : ''}` : '')
    );
  } catch (e) {
    // fs, git and resolveAdapter throw an Error.
    console.error(`[build-record] ${/** @type {Error} */ (e).message}`);
    process.exit(1);
  }
}
