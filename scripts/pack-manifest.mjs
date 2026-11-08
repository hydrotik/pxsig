#!/usr/bin/env node
/**
 * pack-manifest.mjs — the release workflow's pack job publishes package.json files without the
 * keys that only matter in this repository: `scripts` (pxsig's `prepack` points at
 * `../../scripts/`, and `test` runs the repository's tests) and `devDependencies`. Every published
 * tarball carries the root LICENSE (REQUIRED_FILES), and its README links to the documents of the
 * version packed (lib/doc-links.mjs): `blob/main` becomes `blob/v<version>`, a relative link that
 * leaves the package becomes a link to that file on GitHub at the same tag, and a relative image
 * one to raw.githubusercontent.com at that tag. pxsig's packed README is the repository's
 * README.md (README_SOURCE), so npm's page and GitHub's show the same introduction.
 *
 *   node scripts/pack-manifest.mjs <package dir>...    rewrite each package.json in place,
 *                                                      copy the root LICENSE in (git-ignored)
 *                                                      and write its README with pinned links
 *   node scripts/pack-manifest.mjs --check <tgz>...    fail if a packed manifest still has them,
 *                                                      a REQUIRED_FILES file is missing, or a
 *                                                      packed .md links to main or to a file the
 *                                                      tarball does not hold
 *
 * The rewrite runs in the job's checkout only, like the optionalDependencies edit; nothing is
 * committed, and a local clone keeps its scripts and README. The job runs pxsig's prepack step itself first,
 * then packs with --ignore-scripts. Exit 1 on a failure, 2 on a usage error.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { leftLinks, versionLinks } from './lib/doc-links.mjs';

/** Keys a published package.json leaves out. */
export const DEV_ONLY = ['scripts', 'devDependencies'];
/** Files every published tarball holds at its root. */
export const REQUIRED_FILES = ['LICENSE'];
/**
 * Packages whose packed README is another file in the repository (a path from its root) instead
 * of their own README.md: npm's page for pxsig shows the repository's introduction.
 * @type {Record<string, string>}
 */
export const README_SOURCE = { pxsig: 'README.md' };

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

/**
 * Where a package's packed README comes from in the repository: README_SOURCE, else README.md in
 * its `repository.directory`; undefined when neither applies (a fixture without a directory).
 * @param {Record<string, unknown>} pj
 */
export function readmeSource(pj) {
  const own = README_SOURCE[String(pj.name)];
  if (own) return own;
  const from = /** @type {{ directory?: unknown } | undefined} */ (pj.repository)?.directory;
  return typeof from === 'string' ? `${from}/README.md` : undefined;
}

/** @param {string} dir */
function rewrite(dir) {
  const f = join(dir, 'package.json');
  // A package.json is a JSON object.
  const pj = /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(f, 'utf8')));
  writeFileSync(f, `${JSON.stringify(publishedManifest(pj), null, 2)}\n`);
  copyFileSync(join(repo, 'LICENSE'), join(dir, 'LICENSE'));
  const source = readmeSource(pj);
  const own = README_SOURCE[String(pj.name)];
  const input = own ? join(repo, own) : join(dir, 'README.md');
  if (source && existsSync(input)) {
    const root = resolve(dir) + sep;
    writeFileSync(
      join(dir, 'README.md'),
      versionLinks(readFileSync(input, 'utf8'), {
        version: String(pj.version),
        source,
        // A README from elsewhere in the repository names no file of the package as written: each
        // relative link leads to GitHub at the tag (npm would resolve it inside the package's folder).
        held: (p) => !own && resolve(dir, p).startsWith(root) && existsSync(join(dir, p)),
      })
    );
  }
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
 * Every path a tarball holds.
 * @param {string} tgz
 */
function listing(tgz) {
  const r = spawnSync('tar', ['-tzf', tgz], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${tgz}: not a readable tarball (${r.stderr.trim()})`);
  return r.stdout.split(/\r?\n/).filter(Boolean);
}

/**
 * The REQUIRED_FILES a tarball does not hold.
 * @param {string[]} listed
 */
const missingFiles = (listed) => REQUIRED_FILES.filter((f) => !listed.includes(`package/${f}`));

/**
 * Each packed .md file's links to main or to a path the tarball does not hold (a file, or a
 * folder some file is in), as `<file>: <link>`.
 * @param {string} tgz
 * @param {string[]} listed
 */
function badLinks(tgz, listed) {
  return listed
    .filter((f) => f.endsWith('.md'))
    .flatMap((f) => {
      const r = spawnSync('tar', ['-xzOf', tgz, f], { encoding: 'utf8' });
      /** @param {string} p */
      const held = (p) => {
        const t = posix.normalize(posix.join(posix.dirname(f), p)).replace(/\/$/, '');
        return listed.some((l) => l === t || l.startsWith(`${t}/`));
      };
      return leftLinks(r.stdout, held).map((l) => `${f.slice('package/'.length)}: ${l}`);
    });
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
      const listed = listing(t);
      const missing = missingFiles(listed);
      const links = badLinks(t, listed);
      if (left.length) console.error(`[pack-manifest] ${t}: still has ${left.join(', ')}`);
      if (missing.length)
        console.error(`[pack-manifest] ${t}: does not hold ${missing.join(', ')}`);
      for (const l of links)
        console.error(`[pack-manifest] ${t}: a link to main or out of the package: ${l}`);
      if (left.length || missing.length || links.length) failed++;
      else console.log(`[pack-manifest] ${t}: ok`);
    } else {
      const removed = rewrite(t);
      console.log(
        `[pack-manifest] ${t}: removed ${removed.length ? removed.join(', ') : 'nothing'}, LICENSE copied, README links pinned`
      );
    }
  }
  process.exit(failed ? 1 : 0);
}
