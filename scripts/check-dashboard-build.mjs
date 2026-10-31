#!/usr/bin/env node
/**
 * check-dashboard-build.mjs — the release's check of the dashboard it ships: `BUILD.json`
 * (scripts/build-record.mjs) must say how the bundle was built, whichever way the release got it
 * (built from the design system in the workflow, or the pxsig-dashboard.tar.gz attached to the
 * GitHub release).
 *
 *   node scripts/check-dashboard-build.mjs <dashboard dir> [--adapter <name>] [--commit <sha>]
 *
 * Fails (exit 1) when BUILD.json is missing or unreadable, has no `bundled` list (the release SBOM
 * reads it, scripts/bundle-sbom.mjs), names another adapter than `--adapter`, or, for a design
 * system adapter, records no full commit of the design system (or not `--commit`). A design system
 * checkout with changes is a warning. Exit 2 on a usage error.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;

/**
 * @typedef {{ adapter?: unknown, designSystem?: { commit?: unknown, dirty?: unknown } | null, bundled?: unknown }} BuildRecord
 */

/**
 * The problems with a dashboard's BUILD.json: `errors` fail the release, `warnings` are reported.
 * @param {string} dir
 * @param {{ adapter?: string | null, commit?: string | null }} [want]
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkBuild(dir, { adapter = null, commit = null } = {}) {
  const file = join(dir, 'BUILD.json');
  if (!existsSync(file))
    return {
      errors: [
        'no BUILD.json: nothing records how this bundle was built (build it with `pnpm --filter @pxsig/dashboard build`, docs/releasing.md)',
      ],
      warnings: [],
    };
  /** @type {BuildRecord} */
  let b;
  try {
    // BUILD.json, as build-record.mjs writes it; each field is checked below.
    b = /** @type {BuildRecord} */ (JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    return {
      errors: [`BUILD.json is not JSON: ${/** @type {Error} */ (e).message}`],
      warnings: [],
    };
  }
  const errors = [];
  const warnings = [];
  if (!Array.isArray(b.bundled))
    errors.push('BUILD.json has no `bundled` list (the SBOM needs it)');
  if (typeof b.adapter !== 'string') errors.push('BUILD.json names no adapter');
  else if (adapter && b.adapter !== adapter)
    errors.push(`BUILD.json: built with the ${b.adapter} adapter, not ${adapter}`);
  if (b.adapter !== 'plain') {
    const got = b.designSystem?.commit;
    if (typeof got !== 'string' || !SHA.test(got))
      errors.push('BUILD.json records no design-system commit (40-character SHA)');
    else if (commit && got !== commit)
      errors.push(`BUILD.json records design-system commit ${got}, not ${commit}`);
    if (b.designSystem?.dirty === true)
      warnings.push('the design-system checkout had changes when the dashboard was built');
  }
  return { errors, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  /** @param {string} name */
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? '') : null;
  };
  const dir = args[0];
  if (!dir || dir.startsWith('--') || flag('--adapter') === '' || flag('--commit') === '') {
    console.error(
      'usage: check-dashboard-build.mjs <dashboard dir> [--adapter <name>] [--commit <sha>]'
    );
    process.exit(2);
  }
  const { errors, warnings } = checkBuild(dir, {
    adapter: flag('--adapter'),
    commit: flag('--commit'),
  });
  const gh = !!process.env.GITHUB_ACTIONS;
  for (const w of warnings) console.log(gh ? `::warning::${w}` : `[dashboard-build] warning: ${w}`);
  for (const e of errors) console.error(gh ? `::error::${e}` : `[dashboard-build] ${e}`);
  if (!errors.length) console.log(`[dashboard-build] ${join(dir, 'BUILD.json')}: ok`);
  process.exit(errors.length ? 1 : 0);
}
