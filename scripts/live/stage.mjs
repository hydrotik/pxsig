/**
 * live/stage.mjs — the live screens' workspace, prepared on the host (docs/releasing.md, "Live
 * screens"): examples/single-package staged at a fixed folder inside the checkout, installed from
 * its lockfile, its Storybook built twice (as committed, and with the scripted change), and the
 * pristine copies the container restores before every run (scripts/live/run.mjs).
 *
 * pxsig's container installs no pnpm and has no network of its own for the example, and it mounts
 * only the checkout: so the host stages, and the container renders. scripts/screens-container.mjs
 * calls `stageLive` before `docker run`; a stamp (a hash of everything the staging reads) skips it
 * when nothing changed. The folder is under target/ (Cargo's), so git, the formatter, the linter and
 * the size checks ignore it; not under a node_modules/ folder, whose files the React Compiler skips
 * by default (its `sources`), as a project's build would.
 *
 * Layout of LIVE_BASE: packages/ (links to this checkout's packages), examples/single-package/
 * (the workspace), pristine/ (Badge.jsx, storybook-static, storybook-static-after), stamp.json.
 *
 * For the React analysis the workspace also has the React Compiler and Babel (pxsig's own test
 * fixture packages, packages/pxsig/test/react-compiler, linked in with relative links that hold in
 * the container) and a git repository whose `main` is the example as committed: the base the
 * analysis compares with.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyTree } from '../lib/copy-tree.mjs';

export const repo = fileURLToPath(new URL('../..', import.meta.url));
export const EXAMPLE = 'single-package';
/** The staging folder: fixed, inside the mounted checkout, ignored by git (target/). */
export const LIVE_BASE = join(repo, 'target', 'pxsig-live');
export const liveDir = (base = LIVE_BASE) => join(base, 'examples', EXAMPLE);
export const pristineDir = (base = LIVE_BASE) => join(base, 'pristine');
/** The scripted change: one colour, so exactly `components-badge--success@*` changes. */
export const CHANGE = {
  file: 'src/Badge/Badge.jsx',
  from: "success: '#1f7a43'",
  to: "success: '#7a1f6a'",
};
/**
 * The scripted React change (live.react): Badge reads a ref during render, which the React Compiler
 * skips, and nothing drawn changes (no Storybook build follows it).
 */
export const REACT_CHANGE = {
  file: 'src/Badge/Badge.jsx',
  from: '  const colours =',
  to: '  const renders = React.useRef(0);\n  renders.current += 1;\n  const colours =',
};
/** pxsig's React Compiler test fixtures (Babel 7): what the live workspace analyses with. */
const COMPILER = join(repo, 'packages', 'pxsig', 'test', 'react-compiler');
/** Bump when the staging itself changes, so an old stamp never matches. */
const STAGE_VERSION = 4;

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
  h.update(readFileSync(join(COMPILER, 'pnpm-lock.yaml')));
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
  if (!original.includes(REACT_CHANGE.from))
    throw new Error(`${REACT_CHANGE.file} no longer has ${REACT_CHANGE.from.trim()}`);
  log(`git base ${reactBase(dir, pnpm)}`);
  writeFileSync(stampFile, `${JSON.stringify({ stamp }, null, 2)}\n`);
  log('staged');
  return { staged: true, dir };
}

/**
 * The React analysis' setup in the staged workspace: the compiler fixture packages installed and
 * linked in (relative links: the checkout is mounted at its own path in the container), and a git
 * repository whose `main` is the example as committed.
 * @param {string} dir the staged workspace
 * @param {(args: string[], cwd: string) => unknown} pnpm
 * @returns {string} the base commit (short)
 */
function reactBase(dir, pnpm) {
  pnpm(['install', '--frozen-lockfile', '--ignore-scripts'], COMPILER);
  const from = join(COMPILER, 'babel7', 'node_modules');
  for (const name of ['babel-plugin-react-compiler', '@babel/core']) {
    const at = join(dir, 'node_modules', name);
    mkdirSync(dirname(at), { recursive: true });
    symlinkSync(relative(dirname(at), join(from, name)), at, 'dir');
  }
  writeFileSync(join(dir, '.gitignore'), 'node_modules\nstorybook-static*\n.pxsig\n');
  // As a project's store asks: baselines are binary to git (no line-endings warning).
  writeFileSync(join(dir, '.gitattributes'), '*.psig binary\n');
  // The base is the same commit from every checkout: the example's own files (its package.json as
  // committed, not the copy staging adds the checkout's packageManager to), a fixed author and
  // committer, a fixed date, no signing, no line-ending conversion.
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'pxsig live',
    GIT_AUTHOR_EMAIL: 'live@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_NAME: 'pxsig live',
    GIT_COMMITTER_EMAIL: 'live@example.invalid',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  };
  /** @param {string[]} args */
  const git = (args) => {
    const r = spawnSync(
      'git',
      ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args],
      {
        cwd: dir,
        encoding: 'utf8',
        env,
      }
    );
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const pj = join(dir, 'package.json');
  const staged = readFileSync(pj);
  writeFileSync(pj, readFileSync(join(repo, 'examples', EXAMPLE, 'package.json')));
  try {
    git(['init', '-q', '-b', 'main']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'base']);
  } finally {
    writeFileSync(pj, staged);
  }
  // package.json differs from the base only by packageManager: not a module the analysis reads.
  return git(['rev-parse', '--short', 'HEAD']);
}
