/**
 * live/stage.mjs — the live screens' workspace, prepared on the host (docs/releasing.md, "Live
 * screens"): examples/single-package staged at a fixed folder inside the checkout, installed from
 * its lockfile, its Storybook built twice (as committed, and with the scripted change), and the
 * pristine copies the container restores before every run (scripts/live/run.mjs).
 *
 * pxsig's container installs no pnpm and has no network of its own for the example, and it mounts
 * only the checkout: so the host stages, and the container renders. scripts/screens-container.mjs
 * calls `stageLive` before `docker run`; a stamp (a hash of everything the staging reads) skips it
 * when nothing changed. The folder is under node_modules/, so git and the size checks ignore it.
 *
 * Layout of LIVE_BASE: packages/ (links to this checkout's packages), examples/single-package/
 * (the workspace), pristine/ (Badge.jsx, storybook-static, storybook-static-after), stamp.json.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyTree } from '../lib/copy-tree.mjs';

export const repo = fileURLToPath(new URL('../..', import.meta.url));
export const EXAMPLE = 'single-package';
/** The staging folder: fixed, inside the mounted checkout, ignored by git (node_modules/). */
export const LIVE_BASE = join(repo, 'node_modules', '.cache', 'pxsig', 'live');
export const liveDir = (base = LIVE_BASE) => join(base, 'examples', EXAMPLE);
export const pristineDir = (base = LIVE_BASE) => join(base, 'pristine');
/** The scripted change: one colour, so exactly `components-badge--success@*` changes. */
export const CHANGE = {
  file: 'src/Badge/Badge.jsx',
  from: "success: '#1f7a43'",
  to: "success: '#7a1f6a'",
};
/** Bump when the staging itself changes, so an old stamp never matches. */
const STAGE_VERSION = 1;

/**
 * Every file under `dir` but generated folders, as `relative path → sha256`, in name order.
 * @param {string} dir
 * @param {string} [root]
 * @returns {string[]}
 */
function fileHashes(dir, root = dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (/^(node_modules|storybook-static.*|\.pxsig|__pxsig__|dist)$/.test(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...fileHashes(p, root));
    else
      out.push(
        `${relative(root, p).split('\\').join('/')} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`
      );
  }
  return out;
}

/** The stamp: the example's files, the packages it links to, and this staging's version. */
export function stageStamp() {
  const h = createHash('sha256').update(`v${STAGE_VERSION}\n`);
  for (const [label, dir] of [
    ['example', join(repo, 'examples', EXAMPLE)],
    ['addon', join(repo, 'packages', 'storybook-addon')],
  ])
    h.update(`${label}\n${fileHashes(dir).join('\n')}\n`);
  h.update(readFileSync(join(repo, 'packages', 'pxsig', 'package.json')));
  return h.digest('hex');
}

/**
 * Stage, install and build, unless the stamp matches what is there. Returns what it did.
 * @param {{ log?: (m: string) => void, base?: string }} [opts]
 * @returns {Promise<{ staged: boolean, dir: string }>}
 */
export async function stageLive({
  log = (m) => console.log(`[live] ${m}`),
  base = LIVE_BASE,
} = {}) {
  const stamp = stageStamp();
  const stampFile = join(base, 'stamp.json');
  const dir = liveDir(base);
  // stamp.json, as this function writes it.
  const was = existsSync(stampFile)
    ? /** @type {{ stamp?: string }} */ (JSON.parse(readFileSync(stampFile, 'utf8'))).stamp
    : null;
  if (
    was === stamp &&
    existsSync(join(pristineDir(base), 'storybook-static-after', 'index.json'))
  ) {
    log('staged workspace up to date');
    return { staged: false, dir };
  }
  // Staging needs no engine: shared.mjs checks for one only when it is not set.
  process.env.PXSIG_STAGE_ONLY = '1';
  const { stage, install, pnpm } = await import('../examples/shared.mjs');
  log(`staging examples/${EXAMPLE}`);
  stage(EXAMPLE, { base });
  install(dir, { browser: false });
  // Quiet: a failure throws with the output; a success prints nothing (no paths in the log).
  pnpm(['build-storybook'], dir);
  const src = join(dir, CHANGE.file);
  const original = readFileSync(src, 'utf8');
  if (!original.includes(CHANGE.from))
    throw new Error(`${CHANGE.file} no longer has ${CHANGE.from}`);
  const pristine = pristineDir(base);
  copyTree(src, join(pristine, 'Badge.jsx'));
  writeFileSync(src, original.replace(CHANGE.from, CHANGE.to));
  try {
    pnpm(['exec', 'storybook', 'build', '-o', 'storybook-static-after', '--quiet'], dir);
  } finally {
    writeFileSync(src, original);
  }
  renameSync(join(dir, 'storybook-static-after'), join(pristine, 'storybook-static-after'));
  copyTree(join(dir, 'storybook-static'), join(pristine, 'storybook-static'));
  writeFileSync(stampFile, `${JSON.stringify({ stamp }, null, 2)}\n`);
  log('staged');
  return { staged: true, dir };
}
