#!/usr/bin/env node
/**
 * release-files.mjs — the last step of the release workflow's pack job: put the raw binaries next
 * to the packed npm tarballs and write SHA256SUMS over everything a release ships.
 *
 *   node scripts/release-files.mjs --artifacts <dir> --out <dir>
 *   node scripts/release-files.mjs --check <dir>
 *
 * --artifacts holds `pxsig-<platform>-<arch>/pxsig[.exe]`, the layout `actions/download-artifact`
 * produces for the build job (as for make-platform-packages.mjs). Each binary is copied, byte for
 * byte, to `<out>/pxsig-<platform>-<arch>[.exe]`; the copy inside each `@pxsig/cli-*` package is the
 * same file, so one checksum and one attestation cover both.
 *
 * SHA256SUMS lists every other file in <out> (sorted, `<sha256>  <name>`, the format of
 * `shasum -a 256 -c` and `sha256sum -c`). --check verifies a folder against its SHA256SUMS.
 * Node >= 20, no dependencies. Exit 1 on a failure, 2 on a usage error.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SUMS = 'SHA256SUMS';
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Copy `<artifacts>/pxsig-<p>-<a>/pxsig[.exe]` to `<out>/pxsig-<p>-<a>[.exe]`; returns the names. */
export function copyBinaries(artifacts, out) {
  mkdirSync(out, { recursive: true });
  const names = [];
  for (const dir of readdirSync(artifacts).sort()) {
    if (!/^pxsig-[a-z0-9]+-[a-z0-9]+$/.test(dir) || !statSync(join(artifacts, dir)).isDirectory())
      continue;
    const exe = ['pxsig', 'pxsig.exe'].find((f) => existsSync(join(artifacts, dir, f)));
    if (!exe) throw new Error(`${dir}: no pxsig or pxsig.exe`);
    const name = exe.endsWith('.exe') ? `${dir}.exe` : dir;
    copyFileSync(join(artifacts, dir, exe), join(out, name));
    names.push(name);
  }
  if (!names.length) throw new Error(`no pxsig-<platform>-<arch>/ folders in ${artifacts}`);
  return names;
}

/** Write `<dir>/SHA256SUMS` over every other file in <dir>; returns its text. */
export function writeSums(dir) {
  const files = readdirSync(dir)
    .filter((f) => f !== SUMS && statSync(join(dir, f)).isFile())
    .sort();
  if (!files.length) throw new Error(`nothing to checksum in ${dir}`);
  const text = files.map((f) => `${sha256(join(dir, f))}  ${f}\n`).join('');
  writeFileSync(join(dir, SUMS), text);
  return text;
}

/** Verify <dir> against its SHA256SUMS: `{ ok, bad: [names], missing: [names] }`. */
export function checkSums(dir) {
  const bad = [];
  const missing = [];
  for (const line of readFileSync(join(dir, SUMS), 'utf8').split('\n').filter(Boolean)) {
    const [hash, name] = [line.slice(0, 64), line.slice(66)];
    if (!existsSync(join(dir, name))) missing.push(name);
    else if (sha256(join(dir, name)) !== hash) bad.push(name);
  }
  return { ok: !bad.length && !missing.length, bad, missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  try {
    if (opt('--check')) {
      const r = checkSums(opt('--check'));
      for (const n of r.bad) console.error(`[release-files] ${n}: checksum does not match`);
      for (const n of r.missing) console.error(`[release-files] ${n}: missing`);
      console.log(r.ok ? `[release-files] ok · ${SUMS} matches` : '[release-files] failed');
      process.exit(r.ok ? 0 : 1);
    }
    const [artifacts, out] = [opt('--artifacts'), opt('--out')];
    if (!artifacts || !out) {
      console.error('usage: release-files.mjs --artifacts <dir> --out <dir> | --check <dir>');
      process.exit(2);
    }
    const bins = copyBinaries(artifacts, out);
    const sums = writeSums(out);
    console.log(`[release-files] ${bins.length} binaries; ${SUMS}:\n${sums}`);
  } catch (e) {
    console.error(`[release-files] ${e.message}`);
    process.exit(1);
  }
}
