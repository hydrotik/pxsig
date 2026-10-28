#!/usr/bin/env node
/**
 * check-versions.mjs — every version this repository releases agrees, and with the tag.
 *
 *   node scripts/check-versions.mjs              # the version files agree with each other (CI, clean)
 *   node scripts/check-versions.mjs --tag v1.2.3 # and with the tag being released (release.yml)
 *
 * Read: `Cargo.toml` `[workspace.package] version`, the workspace crates in `Cargo.lock`, and the
 * `version` of `packages/pxsig`, `packages/storybook-addon` and `packages/dashboard`. A release
 * publishes each package at its own `version`, and skips one already on npm, so a forgotten bump
 * would otherwise go green without publishing it.
 * Exit: 0 they agree (prints the version) · 1 a mismatch (each source named) · 2 usage.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The package.json files whose `version` is released with the engine. */
export const PACKAGES = ['packages/pxsig', 'packages/storybook-addon', 'packages/dashboard'];
/** The workspace crates, as Cargo.lock names them. */
export const CRATES = ['pxsig-core', 'pxsig-cli'];

/**
 * `[workspace.package] version` from Cargo.toml's text, or null.
 * @param {string} text
 */
export function cargoWorkspaceVersion(text) {
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    const section = /^\s*\[([^\]]+)\]\s*(#.*)?$/.exec(line);
    if (section) {
      inSection = section[1].trim() === 'workspace.package';
      continue;
    }
    const v = inSection && /^\s*version\s*=\s*"([^"]*)"/.exec(line);
    if (v) return v[1];
  }
  return null;
}

/**
 * Each named package's version in Cargo.lock's text (`[[package]]` blocks).
 * @param {string} text
 * @param {string[]} names
 * @returns {Map<string, string>}
 */
export function cargoLockVersions(text, names) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const block of text.split(/^\[\[package\]\]\s*$/m)) {
    const name = /^name = "([^"]*)"/m.exec(block)?.[1];
    const version = /^version = "([^"]*)"/m.exec(block)?.[1];
    if (name && version && names.includes(name)) out.set(name, version);
  }
  return out;
}

/**
 * Every released version in a checkout, with where it was read.
 * @param {string} root
 * @returns {{ source: string, version: string | null }[]}
 */
export function readVersions(root) {
  /** @param {string} f */
  const read = (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : null);
  /** @type {{ source: string, version: string | null }[]} */
  const found = [];
  const cargo = read('Cargo.toml');
  found.push({
    source: 'Cargo.toml [workspace.package]',
    version: cargo === null ? null : cargoWorkspaceVersion(cargo),
  });
  const lock = read('Cargo.lock');
  const locked = cargoLockVersions(lock ?? '', CRATES);
  for (const c of CRATES) found.push({ source: `Cargo.lock ${c}`, version: locked.get(c) ?? null });
  for (const p of PACKAGES) {
    const text = read(`${p}/package.json`);
    /** @type {unknown} */
    const json = text === null ? null : JSON.parse(text);
    const version =
      json && typeof json === 'object' && 'version' in json && typeof json.version === 'string'
        ? json.version
        : null;
    found.push({ source: `${p}/package.json`, version });
  }
  return found;
}

/**
 * What disagrees: a source with no version, a source unlike the first, or the tag (`v` stripped)
 * unlike them. Empty when everything agrees.
 * @param {{ source: string, version: string | null }[]} versions
 * @param {string | null} [tag]
 */
export function mismatches(versions, tag = null) {
  /** @type {string[]} */
  const problems = [];
  for (const v of versions) if (!v.version) problems.push(`${v.source}: no version found`);
  const known = versions.filter((v) => v.version);
  const expected = tag === null ? known[0]?.version : tag.replace(/^v/, '');
  const what = tag === null ? known[0]?.source : `the tag ${tag}`;
  for (const v of known)
    if (v.version !== expected)
      problems.push(`${v.source} is ${v.version}, ${what} is ${expected}`);
  return problems;
}

/** @param {string[]} args */
function run(args) {
  const i = args.indexOf('--tag');
  const tag = i >= 0 ? args[i + 1] : null;
  if (i >= 0 && (!tag || !/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag))) {
    console.error('usage: node scripts/check-versions.mjs [--tag vX.Y.Z]');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  const versions = readVersions(root);
  const problems = mismatches(versions, tag ?? null);
  if (problems.length) {
    console.error(`[check-versions] ${problems.length} mismatch(es):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(
    `[check-versions] ok · ${versions[0].version}${tag ? ` (tag ${tag})` : ''} in ${versions.length} places`
  );
}

// Imported (by its test) for the pure functions: run nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  run(process.argv.slice(2));
