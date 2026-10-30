#!/usr/bin/env node
/**
 * pack-manifest.mjs — the release workflow's pack job publishes package.json files without the
 * keys that only matter in this repository: `scripts` (pxsig's `prepack` points at
 * `../../scripts/`, and `test` runs the repository's tests) and `devDependencies`. Every published
 * tarball carries the root LICENSE (REQUIRED_FILES).
 *
 *   node scripts/pack-manifest.mjs <package dir>...    rewrite each package.json in place and
 *                                                      copy the root LICENSE in (git-ignored)
 *   node scripts/pack-manifest.mjs --check <tgz>...    fail if a packed manifest still has them,
 *                                                      or a REQUIRED_FILES file is missing
 *
 * The rewrite runs in the job's checkout only, like the optionalDependencies edit; nothing is
 * committed, and a local clone keeps its scripts. The job runs pxsig's prepack step itself first,
 * then packs with --ignore-scripts. Exit 1 on a failure, 2 on a usage error.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Keys a published package.json leaves out. */
export const DEV_ONLY = ['scripts', 'devDependencies'];
/** Files every published tarball holds at its root. */
export const REQUIRED_FILES = ['LICENSE'];

const repo = fileURLToPath(new URL('..', import.meta.url));

/**
 * The manifest as published: the same object without DEV_ONLY keys, key order kept.
 * @param {Record<string, unknown>} pj
 */
export const publishedManifest = (pj) =>
  Object.fromEntries(Object.entries(pj).filter(([k]) => !DEV_ONLY.includes(k)));

/**
 * The DEV_ONLY keys a manifest still has.
 * @param {Record<string, unknown>} pj
 */
export const devOnlyKeys = (pj) => DEV_ONLY.filter((k) => k in pj);

/** @param {string} dir */
function rewrite(dir) {
  const f = join(dir, 'package.json');
  // A package.json is a JSON object.
  const pj = /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(f, 'utf8')));
  writeFileSync(f, `${JSON.stringify(publishedManifest(pj), null, 2)}\n`);
  copyFileSync(join(repo, 'LICENSE'), join(dir, 'LICENSE'));
  return devOnlyKeys(pj);
}

/**
 * @param {string} tgz
 * @returns {Record<string, unknown>}
 */
function packedManifest(tgz) {
  const r = spawnSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${tgz}: no package/package.json (${r.stderr.trim()})`);
  // The packed package.json: a JSON object.
  return /** @type {Record<string, unknown>} */ (JSON.parse(r.stdout));
}

/**
 * The REQUIRED_FILES a tarball does not hold.
 * @param {string} tgz
 */
function missingFiles(tgz) {
  const r = spawnSync('tar', ['-tzf', tgz], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${tgz}: not a readable tarball (${r.stderr.trim()})`);
  const listed = new Set(r.stdout.split(/\r?\n/));
  return REQUIRED_FILES.filter((f) => !listed.has(`package/${f}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const check = args[0] === '--check';
  const targets = check ? args.slice(1) : args;
  if (!targets.length) {
    console.error('usage: pack-manifest.mjs <package dir>... | --check <tgz>...');
    process.exit(2);
  }
  let failed = 0;
  for (const t of targets) {
    if (check) {
      const left = devOnlyKeys(packedManifest(t));
      const missing = missingFiles(t);
      if (left.length) console.error(`[pack-manifest] ${t}: still has ${left.join(', ')}`);
      if (missing.length)
        console.error(`[pack-manifest] ${t}: does not hold ${missing.join(', ')}`);
      if (left.length || missing.length) failed++;
      else console.log(`[pack-manifest] ${t}: ok`);
    } else {
      const removed = rewrite(t);
      console.log(
        `[pack-manifest] ${t}: removed ${removed.length ? removed.join(', ') : 'nothing'}, LICENSE copied`
      );
    }
  }
  process.exit(failed ? 1 : 0);
}
