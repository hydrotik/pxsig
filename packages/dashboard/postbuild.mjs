/// <reference types="node" />
// A classic script (IIFE) also runs from file://, where module scripts are blocked.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Rewrites the built index.html in `outDir` to load the bundle as a classic script.
 * @param {string} outDir
 */
export function classicScript(outDir) {
  const index = path.join(outDir, 'index.html');
  writeFileSync(
    index,
    readFileSync(index, 'utf8')
      .replace(
        /<script type="module" crossorigin src="([^"]+)"><\/script>/,
        '<script defer src="$1"></script>'
      )
      .replace(/ crossorigin/g, '')
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  classicScript(
    process.env.PXSIG_DASHBOARD_OUT
      ? path.resolve(process.env.PXSIG_DASHBOARD_OUT)
      : fileURLToPath(new URL('../pxsig/dist/dashboard', import.meta.url))
  );
}
