#!/usr/bin/env node
/**
 * sync-dashboard-source.mjs — copies what `pxsig dashboard build | gaps` and adapter authors need
 * into the pxsig package before it is packed (its `prepack` script):
 *
 *   packages/dashboard/{src, fixtures, index.html, build-config.mjs, postbuild.mjs, ui-tools.mjs,
 *                       ui-tools, README.md}
 *                                         → packages/pxsig/dashboard/
 *   docs/ui/                              → packages/pxsig/docs/ui/
 *   LICENSE                               → packages/pxsig/LICENSE
 *
 * All three targets are git-ignored. The prebuilt dashboard (dist/dashboard) is not touched.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyTree } from './lib/copy-tree.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const from = join(repo, 'packages', 'dashboard');
const pkg = join(repo, 'packages', 'pxsig');
const to = join(pkg, 'dashboard');

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const f of [
  'src',
  'fixtures',
  'index.html',
  'build-config.mjs',
  'postbuild.mjs',
  'ui-tools.mjs',
  'ui-tools',
  'README.md',
])
  copyTree(join(from, f), join(to, f));
const docs = join(repo, 'docs', 'ui');
rmSync(join(pkg, 'docs'), { recursive: true, force: true });
if (existsSync(docs)) copyTree(docs, join(pkg, 'docs', 'ui'));
copyFileSync(join(repo, 'LICENSE'), join(pkg, 'LICENSE'));
console.log('[sync] dashboard source, docs/ui and LICENSE copied into packages/pxsig');
