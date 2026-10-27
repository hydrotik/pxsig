#!/usr/bin/env node
/**
 * pack-manifest.mjs — the release workflow's pack job publishes package.json files without the
 * keys that only matter in this repository: `scripts` (pxsig's `prepack` points at
 * `../../scripts/`, and `test` runs the repository's tests) and `devDependencies`.
 *
 *   node scripts/pack-manifest.mjs <package dir>...    rewrite each package.json in place
 *   node scripts/pack-manifest.mjs --check <tgz>...    fail if a packed manifest still has them
 *
 * The rewrite runs in the job's checkout only, like the optionalDependencies edit; nothing is
 * committed, and a local clone keeps its scripts. The job runs pxsig's prepack step itself first,
 * then packs with --ignore-scripts. Exit 1 on a failure, 2 on a usage error.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Keys a published package.json leaves out. */
export const DEV_ONLY = ['scripts', 'devDependencies'];

/** The manifest as published: the same object without DEV_ONLY keys, key order kept. */
export const publishedManifest = (pj) =>
  Object.fromEntries(Object.entries(pj).filter(([k]) => !DEV_ONLY.includes(k)));

/** The DEV_ONLY keys a manifest still has. */
export const devOnlyKeys = (pj) => DEV_ONLY.filter((k) => k in pj);

function rewrite(dir) {
  const f = join(dir, 'package.json');
  const pj = JSON.parse(readFileSync(f, 'utf8'));
  writeFileSync(f, `${JSON.stringify(publishedManifest(pj), null, 2)}\n`);
  return devOnlyKeys(pj);
}

function packedManifest(tgz) {
  const r = spawnSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${tgz}: no package/package.json (${r.stderr.trim()})`);
  return JSON.parse(r.stdout);
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
      if (left.length)
        (failed++, console.error(`[pack-manifest] ${t}: still has ${left.join(', ')}`));
      else console.log(`[pack-manifest] ${t}: ok`);
    } else {
      const removed = rewrite(t);
      console.log(
        `[pack-manifest] ${t}: removed ${removed.length ? removed.join(', ') : 'nothing'}`
      );
    }
  }
  process.exit(failed ? 1 : 0);
}
