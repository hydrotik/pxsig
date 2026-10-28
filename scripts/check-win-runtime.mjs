#!/usr/bin/env node
/**
 * check-win-runtime.mjs — a Windows pxsig.exe imports no Visual C++ runtime DLL.
 *
 *   node scripts/check-win-runtime.mjs <pxsig.exe>
 *
 * The engine is built with `crt-static` (.cargo/config.toml), so it needs nothing beyond Windows
 * itself; the Universal CRT (`api-ms-win-crt-*`, `ucrtbase.dll`) ships with Windows 10 and 11. A
 * PE file names the DLLs it imports as plain ASCII, which is what this reads: no Windows tools.
 * Exit 1 naming the DLLs when one is imported, 2 on bad usage.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The Visual C++ runtime DLLs named in a binary (lower case, sorted, once each).
 * @param {Uint8Array} bytes
 */
export function vcRuntimeImports(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  /** @type {Set<string>} */
  const found = new Set();
  for (const m of text.matchAll(/(?:vcruntime|msvcp|concrt|vccorlib)\d+(?:_\w+)?\.dll/gi))
    found.add(m[0].toLowerCase());
  return [...found].sort();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/check-win-runtime.mjs <pxsig.exe>');
    process.exit(2);
  }
  const dlls = vcRuntimeImports(readFileSync(file));
  if (dlls.length) {
    console.error(
      `[win-runtime] ${file} imports ${dlls.join(', ')}: a machine without the Visual C++ ` +
        'Redistributable cannot start it. Build with crt-static (.cargo/config.toml).'
    );
    process.exit(1);
  }
  console.log(`[win-runtime] ok · ${file} imports no Visual C++ runtime DLL`);
}
