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
 * All three targets are git-ignored. The prebuilt dashboard (dist/dashboard) is not touched. In
 * the copied Markdown, a link to main or out of the package is pinned to this version's tag
 * (lib/doc-links.mjs), so the dashboard README's links to the repository's docs still lead there.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyTree } from './lib/copy-tree.mjs';
import { versionLinks } from './lib/doc-links.mjs';

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

// pxsig's package.json: its version is the tag the links are pinned to.
const version = /** @type {{ version: string }} */ (
  JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'))
).version;
const inPkg = resolve(pkg) + sep;
/**
 * Pin the links of every .md file under `copy`, whose files came from `source`.
 * @param {string} copy
 * @param {string} source
 */
function pin(copy, source) {
  if (!existsSync(copy)) return;
  for (const e of readdirSync(copy, { withFileTypes: true, recursive: true })) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const f = join(e.parentPath, e.name);
    const from = relative(repo, join(source, relative(copy, f)))
      .split(sep)
      .join('/');
    writeFileSync(
      f,
      versionLinks(readFileSync(f, 'utf8'), {
        version,
        source: from,
        held: (p) => resolve(dirname(f), p).startsWith(inPkg) && existsSync(join(dirname(f), p)),
      })
    );
  }
}
pin(to, from);
pin(join(pkg, 'docs', 'ui'), docs);
console.log(
  `[sync] dashboard source, docs/ui and LICENSE copied into packages/pxsig (links pinned to v${version})`
);
