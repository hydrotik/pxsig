#!/usr/bin/env node
/**
 * check-shots.mjs — a minor or major release ships product shots of its own dashboard.
 *
 *   node scripts/check-shots.mjs --tag v1.2.0
 *
 * scripts/showcase-shots.mjs writes docs/product-shots/shots.json beside the shots it takes,
 * recording the version it shot (packages/pxsig's `version`, set on the release branch first). For
 * a tag X.Y.0 the record must name X.Y and every file it lists must exist; a patch or a prerelease
 * needs nothing. release.yml runs this in its verify job, so the shots are taken and reviewed on
 * the release branch (docs/releasing.md, "Product shots"), never by the workflow.
 * Exit: 0 ok · 1 the shots are missing or from another minor · 2 usage.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHOTS_DIR = 'docs/product-shots';
export const RECORD = 'shots.json';
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

/**
 * Why a release at `tag` may not ship the shots `record` describes, or null when it may.
 * @param {string} tag `vX.Y.Z`
 * @param {{ version?: unknown, files?: unknown } | null} record shots.json, or null when missing
 * @param {(file: string) => boolean} exists
 * @returns {string | null}
 */
export function shotsProblem(tag, record, exists) {
  const t = SEMVER.exec(tag);
  if (!t) throw new Error(`not a version tag: ${tag}`);
  if (t[3] !== '0' || t[4]) return null; // a patch or a prerelease keeps the last shots
  const minor = `${t[1]}.${t[2]}`;
  const fix = `re-shoot them on the release branch: node scripts/showcase-shots.mjs (docs/releasing.md, "Product shots")`;
  if (!record) return `${SHOTS_DIR}/${RECORD} is missing: ${fix}`;
  const v = typeof record.version === 'string' ? SEMVER.exec(record.version) : null;
  if (!v || `${v[1]}.${v[2]}` !== minor)
    return `the product shots are from ${String(record.version)}, not ${minor}: ${fix}`;
  const files = Array.isArray(record.files) ? record.files.map(String) : [];
  if (!files.length) return `${RECORD} lists no shots: ${fix}`;
  const gone = files.filter((f) => !exists(f));
  return gone.length ? `${RECORD} lists shots that are missing: ${gone.join(', ')}` : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--tag');
  const tag = i >= 0 ? process.argv[i + 1] : undefined;
  if (!tag || !SEMVER.test(tag)) {
    console.error('usage: check-shots.mjs --tag vX.Y.Z');
    process.exit(2);
  }
  const dir = join(fileURLToPath(new URL('..', import.meta.url)), SHOTS_DIR);
  const file = join(dir, RECORD);
  // shots.json, as showcase-shots.mjs writes it; shotsProblem checks each field.
  const record = existsSync(file)
    ? /** @type {{ version?: unknown, files?: unknown }} */ (JSON.parse(readFileSync(file, 'utf8')))
    : null;
  const problem = shotsProblem(tag, record, (f) => existsSync(join(dir, f)));
  const gh = !!process.env.GITHUB_ACTIONS;
  if (problem) {
    console.error(gh ? `::error::${problem}` : `[shots] ${problem}`);
    process.exit(1);
  }
  const [, , , patch, pre] = /** @type {RegExpExecArray} */ (SEMVER.exec(tag));
  const minorRelease = patch === '0' && !pre;
  console.log(
    `[shots] ${tag}: ${minorRelease ? `shots from ${String(record?.version)}` : 'a patch or prerelease keeps the last shots'}`
  );
}
