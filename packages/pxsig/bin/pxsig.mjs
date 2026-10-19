#!/usr/bin/env node
// The `pxsig` command: inside a workspace with its own pxsig install, that install runs instead,
// so one engine writes and checks every baseline in the workspace.
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = realpathSync(dirname(fileURLToPath(import.meta.url)));
if (!process.env.PXSIG_NO_DELEGATE) {
  let dir = process.cwd();
  for (;;) {
    const bin = join(dir, 'node_modules', 'pxsig', 'bin', 'pxsig.mjs');
    if (existsSync(join(dir, 'pxsig.workspace.json')) || existsSync(join(dir, '.git'))) {
      if (existsSync(bin) && realpathSync(dirname(bin)) !== here) {
        process.env.PXSIG_NO_DELEGATE = '1';
        await import(pathToFileURL(bin).href);
        process.exit(process.exitCode ?? 0);
      }
      break;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
}
await import('../src/cli.mjs');
