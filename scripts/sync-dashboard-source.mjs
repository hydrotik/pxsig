#!/usr/bin/env node
/**
 * sync-dashboard-source.mjs — copies what `pxsig dashboard build | gaps` and adapter authors need
 * into the pxsig package before it is packed (its `prepack` script):
 *
 *   packages/dashboard/{src, index.html, build-config.mjs, postbuild.mjs, ui-tools.mjs, README.md}
 *                                         → packages/pxsig/dashboard/
 *   docs/ui/                              → packages/pxsig/docs/ui/
 *
 * Both targets are git-ignored. The prebuilt dashboard (dist/dashboard) is not touched.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const from = join(repo, 'packages', 'dashboard');
const pkg = join(repo, 'packages', 'pxsig');
const to = join(pkg, 'dashboard');

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const f of ['src', 'index.html', 'build-config.mjs', 'postbuild.mjs', 'ui-tools.mjs', 'README.md']) cpSync(join(from, f), join(to, f), { recursive: true });
const docs = join(repo, 'docs', 'ui');
rmSync(join(pkg, 'docs'), { recursive: true, force: true });
if (existsSync(docs)) cpSync(docs, join(pkg, 'docs', 'ui'), { recursive: true });
console.log('[sync] dashboard source and docs/ui copied into packages/pxsig');
