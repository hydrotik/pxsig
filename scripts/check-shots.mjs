#!/usr/bin/env node
/**
 * check-shots.mjs — a release ships product shots that still show its own dashboard.
 *
 *   node scripts/check-shots.mjs --tag v1.2.3
 *
 * scripts/showcase-shots.mjs writes docs/product-shots/shots.json beside the shots it takes,
 * recording the version it shot (packages/pxsig's `version`, set on the release branch first).
 * For every release tag (a prerelease is exempt):
 *   - shots.json must exist and every file it lists must exist;
 *   - a minor or major tag X.Y.0 needs shots taken at X.Y;
 *   - none of pxsig's own dashboard screen baselines (SCREENS: the approved pixel baselines the
 *     screens job compares against) may have changed between the tag v<shots.json version> and
 *     HEAD, so a patch that moved a screen re-shoots too.
 * release.yml runs this in its verify job, so the shots are taken and reviewed on the release
 * branch (docs/releasing.md, "Product shots"), never by the workflow.
 * Exit: 0 ok · 1 the shots are missing, from another minor or older than a screen · 2 usage.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHOTS_DIR = 'docs/product-shots';
export const RECORD = 'shots.json';
/**
 * The dashboard's screens: its approved pixel baselines (`*.psig`), fixture and live screens.
 * The locked structure snapshots (fixtures/locked) are left out: they record roles, names and
 * boxes, and any change to them that a shot could show also moves a pixel baseline.
 */
export const SCREENS = 'packages/dashboard/.pxsig/baselines';
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
const SHOWN = 12;

/**
 * The screen a baseline path holds: `<group>/<story>@<mode>.psig` → `<story>@<mode>`.
 * @param {string} path
 */
export const screenOf = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.psig$/, '');

/**
 * Why a release at `tag` may not ship the shots `record` describes, or null when it may.
 * @param {string} tag `vX.Y.Z`
 * @param {{ version?: unknown, files?: unknown } | null} record shots.json, or null when missing
 * @param {(file: string) => boolean} exists whether a file in SHOTS_DIR exists
 * @param {(since: string) => string[] | null} changed the SCREENS baseline paths that differ
 *   between the tag `since` and HEAD, or null when that tag does not exist
 * @returns {string | null}
 */
export function shotsProblem(tag, record, exists, changed) {
  const t = SEMVER.exec(tag);
  if (!t) throw new Error(`not a version tag: ${tag}`);
  if (t[4]) return null; // a prerelease keeps the last shots
  const fix = `re-shoot them on the release branch: node scripts/showcase-shots.mjs (docs/releasing.md, "Product shots")`;
  if (!record) return `${SHOTS_DIR}/${RECORD} is missing: ${fix}`;
  const v = typeof record.version === 'string' ? SEMVER.exec(record.version) : null;
  if (!v) return `${RECORD} names no version (${String(record.version)}): ${fix}`;
  const minor = `${t[1]}.${t[2]}`;
  if (t[3] === '0' && `${v[1]}.${v[2]}` !== minor)
    return `the product shots are from ${String(record.version)}, not ${minor}: ${fix}`;
  const files = Array.isArray(record.files) ? record.files.map(String) : [];
  if (!files.length) return `${RECORD} lists no shots: ${fix}`;
  const gone = files.filter((f) => !exists(f));
  if (gone.length) return `${RECORD} lists shots that are missing: ${gone.join(', ')}`;
  const shot = `${v[1]}.${v[2]}.${v[3]}${v[4] ?? ''}`;
  // Shots taken at this release's own version: its tag is HEAD (or not made yet), nothing after.
  if (shot === `${t[1]}.${t[2]}.${t[3]}`) return null;
  const since = `v${shot}`;
  const paths = changed(since);
  if (paths === null)
    return `the product shots are from ${shot}, but there is no tag ${since} to compare the dashboard's screens with (git fetch --tags, or correct ${RECORD}'s version)`;
  if (!paths.length) return null;
  const screens = [...new Set(paths.map(screenOf))].sort();
  const more = screens.length > SHOWN ? `, and ${screens.length - SHOWN} more` : '';
  return `${screens.length} of the dashboard's screens changed since the product shots (${shot}): ${screens.slice(0, SHOWN).join(', ')}${more}. Re-shoot them on the release branch: node scripts/showcase-shots.mjs (docs/releasing.md, "Product shots")`;
}

/**
 * The SCREENS baseline paths added, changed or removed between the tag `since` and HEAD in
 * `root`, or null when that tag does not exist.
 * @param {string} root
 * @param {string} since
 * @returns {string[] | null}
 */
export function gitChangedScreens(root, since) {
  /** @param {string[]} a */
  const git = (a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  try {
    git(['rev-parse', '-q', '--verify', `refs/tags/${since}^{commit}`]);
  } catch {
    return null;
  }
  return git(['diff', '--no-renames', '--name-only', since, 'HEAD', '--', SCREENS])
    .split('\n')
    .filter((p) => p.endsWith('.psig'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--tag');
  const tag = i >= 0 ? process.argv[i + 1] : undefined;
  if (!tag || !SEMVER.test(tag)) {
    console.error('usage: check-shots.mjs --tag vX.Y.Z');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dir = join(root, SHOTS_DIR);
  const file = join(dir, RECORD);
  // shots.json, as showcase-shots.mjs writes it; shotsProblem checks each field.
  const record = existsSync(file)
    ? /** @type {{ version?: unknown, files?: unknown }} */ (JSON.parse(readFileSync(file, 'utf8')))
    : null;
  const problem = shotsProblem(
    tag,
    record,
    (f) => existsSync(join(dir, f)),
    (since) => gitChangedScreens(root, since)
  );
  const gh = !!process.env.GITHUB_ACTIONS;
  if (problem) {
    console.error(gh ? `::error::${problem}` : `[shots] ${problem}`);
    process.exit(1);
  }
  const pre = /** @type {RegExpExecArray} */ (SEMVER.exec(tag))[4];
  console.log(
    `[shots] ${tag}: ${pre ? 'a prerelease keeps the last shots' : `shots from ${String(record?.version)}, no dashboard screen changed since`}`
  );
}
