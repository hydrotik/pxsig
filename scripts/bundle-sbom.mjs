#!/usr/bin/env node
/**
 * bundle-sbom.mjs — the third-party packages compiled into the prebuilt dashboard, added to a
 * CycloneDX SBOM. The release's npm SBOM (`pxsig-npm.cdx.json`) lists what installing pxsig
 * brings in; the dashboard bundle (`dist/dashboard/assets/app.js`) inlines packages of its own
 * that npm never sees. This step appends those.
 *
 *   node scripts/bundle-sbom.mjs --dashboard <dir> --sbom <file.cdx.json> [--base <dir>]
 *   node scripts/bundle-sbom.mjs --dashboard <dir> --list [--base <dir>]
 *
 * The packages are read from the module paths the unminified build keeps as comments
 * (`// ../../node_modules/.pnpm/<name>@<version>_<peers>/node_modules/<name>/…`). A licence comes
 * from the dashboard's BUILD.json (`bundled`, written by scripts/build-record.mjs when the bundle
 * was built), else from the package's package.json at that path resolved against --base (the
 * folder the build ran in; default packages/dashboard). A run replaces the components an earlier
 * run added, and the output is sorted, so the same inputs give the same file.
 * Node >= 22, no dependencies. Exit 1 on a failure, 2 on a usage error.
 *
 * @typedef {{ name: string, version: string | null, path: string, license?: string | null }} Bundled
 * @typedef {{ ref: string, dependsOn?: string[] }} CdxDependency
 * @typedef {{ 'bom-ref'?: string, purl?: string, [key: string]: unknown }} CdxComponent
 * @typedef {{ components?: CdxComponent[], dependencies?: CdxDependency[], [key: string]: unknown }} Cdx
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REF_PREFIX = 'pxsig-dashboard|';
const defaultBase = fileURLToPath(new URL('../packages/dashboard', import.meta.url));

// <prefix>node_modules/.pnpm/<key>/node_modules/<name>/  — a pnpm store path; the key starts with
// the name (`/` as `+`), `@`, the version, then `_<peers>` when the package has peers.
const PNPM =
  /([^\s"'`()]*?node_modules\/\.pnpm\/([^/\s"'`]+)\/node_modules\/((?:@[^/\s"'`]+\/)?[^/\s"'`]+))\//g;
// <prefix>node_modules/<name>/ outside the pnpm store (an npm or yarn layout): no version in it.
const FLAT =
  /([^\s"'`()]*?(?<!\.pnpm\/[^/\s]+\/)node_modules\/((?:@[^/.\s"'`][^/\s"'`]*\/)?[^/.\s"'`][^/\s"'`]*))\//g;

/**
 * The packages named by module paths in a bundle's text, sorted by name then version. A pnpm store
 * path gives the version; a flat node_modules path gives `version: null` (resolve it from disk).
 * @param {string} text
 * @returns {Bundled[]}
 */
export function bundledPackages(text) {
  /** @type {Map<string, Bundled>} */
  const found = new Map();
  for (const [, path, key, name] of text.matchAll(PNPM)) {
    const head = `${name.replace('/', '+')}@`;
    // A path through another package's node_modules link names a dependency, not the store entry.
    if (!key.startsWith(head)) continue;
    const version = key.slice(head.length).split('_')[0];
    if (!version || found.has(`${name}@${version}`)) continue;
    found.set(`${name}@${version}`, { name, version, path });
  }
  for (const [, path, name] of text.matchAll(FLAT)) {
    if (path.includes('/.pnpm/') || [...found.values()].some((p) => p.name === name)) continue;
    if (!found.has(`${name}@`)) found.set(`${name}@`, { name, version: null, path });
  }
  return [...found.values()].sort(
    (a, b) => cmp(a.name, b.name) || cmp(a.version ?? '', b.version ?? '')
  );
}

/** @param {string} a @param {string} b */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A package.json's licence as one SPDX string (`license`, or the old `licenses` list), or null.
 * @param {{ license?: unknown, licenses?: unknown }} pj
 * @returns {string | null}
 */
export function licenseOf(pj) {
  const one = (/** @type {unknown} */ l) =>
    typeof l === 'string' ? l : l && typeof l === 'object' && 'type' in l ? String(l.type) : null;
  if (pj.license) return one(pj.license);
  if (Array.isArray(pj.licenses)) {
    const all = pj.licenses.map(one).filter(Boolean);
    return all.length > 1 ? `(${all.join(' OR ')})` : (all[0] ?? null);
  }
  return null;
}

/**
 * Fills in `version` (flat paths) and `license` from each package's package.json under `base`,
 * where it exists; `known` (BUILD.json's `bundled`) is used first.
 * @param {Bundled[]} pkgs
 * @param {string} base
 * @param {Bundled[]} [known]
 * @returns {Bundled[]}
 */
export function resolvePackages(pkgs, base, known = []) {
  return pkgs
    .map((p) => {
      /** @typedef {{ version?: string, license?: unknown, licenses?: unknown }} PackageJson */
      /** @type {PackageJson | null} */
      let pj = null;
      const file = resolve(base, p.path, 'package.json');
      if (existsSync(file)) {
        try {
          pj = /** @type {PackageJson} */ (JSON.parse(readFileSync(file, 'utf8')));
        } catch {
          // an unreadable package.json leaves the licence unknown
        }
      }
      const version = p.version ?? pj?.version ?? null;
      const k = known.find((x) => x.name === p.name && x.version === version);
      return { ...p, version, license: k?.license ?? (pj ? licenseOf(pj) : null) };
    })
    .sort((a, b) => cmp(a.name, b.name) || cmp(a.version ?? '', b.version ?? ''));
}

/**
 * A license entry in CycloneDX form: an SPDX id, an SPDX expression, or a free name.
 * @param {string} l
 */
const cdxLicense = (l) =>
  /\s(OR|AND|WITH)\s/.test(l)
    ? { expression: l.replace(/^\((.*)\)$/, '$1') }
    : /^[A-Za-z0-9.+-]+$/.test(l)
      ? { license: { id: l } }
      : { license: { name: l } };

/**
 * One bundled package as a CycloneDX component (the scope as `group`, as cyclonedx-npm writes it).
 * @param {Bundled} p
 * @param {string} file  the bundle file, as a path inside the pxsig package
 * @returns {CdxComponent}
 */
export function component(p, file) {
  const [group, name] = p.name.startsWith('@') ? p.name.split('/') : [null, p.name];
  const purl = `pkg:npm/${group ? `${encodeURIComponent(group)}/` : ''}${name}${p.version ? `@${p.version}` : ''}`;
  return {
    type: 'library',
    'bom-ref': `${REF_PREFIX}${p.name}@${p.version ?? ''}`,
    ...(group ? { group } : {}),
    name,
    ...(p.version ? { version: p.version } : {}),
    ...(p.license ? { licenses: [cdxLicense(p.license)] } : {}),
    purl,
    properties: [
      { name: 'cdx:npm:package:bundled', value: 'true' },
      { name: 'pxsig:bundled-in', value: file },
    ],
  };
}

/**
 * The SBOM with the bundled packages appended (any added by an earlier run replaced). Each is a
 * dependency of the `pxsig` component when the SBOM has one.
 * @param {Cdx} sbom
 * @param {Bundled[]} pkgs
 * @param {string} file
 * @returns {Cdx}
 */
export function appendBundled(sbom, pkgs, file) {
  const ours = (/** @type {string | undefined} */ ref) => !!ref?.startsWith(REF_PREFIX);
  const added = pkgs.map((p) => component(p, file));
  const refs = added.map((c) => /** @type {string} */ (c['bom-ref']));
  const pxsig = (sbom.components ?? []).find((c) => c.purl?.startsWith('pkg:npm/pxsig@'));
  const deps = (sbom.dependencies ?? [])
    .filter((d) => !ours(d.ref))
    .map((d) => {
      const rest = d.dependsOn?.filter((r) => !ours(r));
      const on = d.ref === pxsig?.['bom-ref'] ? [...(rest ?? []), ...refs] : rest;
      return on && (on.length || d.dependsOn) ? { ...d, dependsOn: on } : d;
    });
  return {
    ...sbom,
    components: [...(sbom.components ?? []).filter((c) => !ours(c['bom-ref'])), ...added],
    dependencies: [...deps, ...refs.map((ref) => ({ ref }))],
  };
}

/**
 * The bundle files under a built dashboard (every .js and .css, sorted), as paths relative to it.
 * @param {string} dir
 * @returns {string[]}
 */
export function bundleFiles(dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ d) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|css)$/.test(f)) out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/**
 * The packages bundled into a built dashboard, with versions and licences where known.
 * @param {string} dir
 * @param {string} [base]
 * @returns {{ file: string, packages: Bundled[] }}
 */
export function dashboardPackages(dir, base = defaultBase) {
  const files = bundleFiles(dir);
  const text = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  /** @type {Bundled[]} */
  let known = [];
  const record = join(dir, 'BUILD.json');
  if (existsSync(record)) {
    try {
      // BUILD.json as scripts/build-record.mjs writes it: `bundled` lists name, version, licence.
      known =
        /** @type {{ bundled?: Bundled[] }} */ (JSON.parse(readFileSync(record, 'utf8'))).bundled ??
        [];
    } catch {
      // an unreadable record: licences come from disk only
    }
  }
  const file = `dist/dashboard/${files.find((f) => f.endsWith('app.js')) ?? files[0] ?? ''}`;
  return { file, packages: resolvePackages(bundledPackages(text), base, known) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  /** @param {string} k */
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const [dir, sbomFile] = [opt('--dashboard'), opt('--sbom')];
  if (!dir || (!sbomFile && !args.includes('--list'))) {
    console.error(
      'usage: bundle-sbom.mjs --dashboard <dir> (--sbom <file.cdx.json> | --list) [--base <dir>]'
    );
    process.exit(2);
  }
  try {
    const { file, packages } = dashboardPackages(dir, opt('--base') ?? defaultBase);
    if (!sbomFile) {
      console.log(JSON.stringify(packages, null, 2));
      process.exit(0);
    }
    // A CycloneDX JSON document, as cyclonedx-npm writes it.
    const sbom = /** @type {Cdx} */ (JSON.parse(readFileSync(sbomFile, 'utf8')));
    writeFileSync(sbomFile, `${JSON.stringify(appendBundled(sbom, packages, file), null, 2)}\n`);
    const noLicence = packages.filter((p) => !p.license).map((p) => p.name);
    console.log(
      `[bundle-sbom] ${packages.length} bundled packages added to ${sbomFile}` +
        (noLicence.length ? `; no licence found for ${noLicence.join(', ')}` : '')
    );
  } catch (e) {
    // fs calls and JSON.parse throw an Error.
    console.error(`[bundle-sbom] ${/** @type {Error} */ (e).message}`);
    process.exit(1);
  }
}
