#!/usr/bin/env node
/**
 * react-parity.mjs — the built-in React Compiler (`pxsig react-compile`, oxc_react_compiler)
 * against the newest release of babel-plugin-react-compiler (the React analysis tests' fixture
 * package, packages/pxsig/test/react-compiler/babel7), per function, on two corpora:
 *
 * - `examples`: the components in examples/ (always);
 * - `fixtures`: the React Compiler's own fixture tests (facebook/react, MIT), fetched with
 *   `--fetch` at the commit scripts/react-parity.json names. Never committed.
 *
 * Both sides run with the options pxsig uses (infer, React 19, lint on). The figures and every
 * function whose outcome differs must match scripts/react-parity.json: a compiler bump that changes
 * them fails here, and its pull request carries the new report (`--update` rewrites the file).
 *
 * Usage:
 *   node scripts/react-parity.mjs --fetch <dir>
 *   node scripts/react-parity.mjs --engine target/release/pxsig [--fixtures <dir>] [--update]
 *
 * Needs the fixture packages (pnpm --dir packages/pxsig/test/react-compiler install) and an engine
 * built with `--features react-oxc`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, load } from '../packages/pxsig/src/lib/react/worker.mjs';
import { findPeer } from '../packages/pxsig/src/lib/react/peers.mjs';
import { compareCorpus, isFlow, parserOf, table } from './lib/react-parity.mjs';

/** @import { CompileResult } from '../packages/pxsig/src/types/react.js' */
/** @import { CorpusParity } from './lib/react-parity.mjs' */

const repo = fileURLToPath(new URL('..', import.meta.url));
const expectedPath = join(repo, 'scripts', 'react-parity.json');
/** @typedef {{ babel: string, oxc: string, fixtures: { repo: string, commit: string, dir: string }, corpora: Record<string, CorpusParity> }} Expected */
const expected = /** @type {Expected} */ (JSON.parse(readFileSync(expectedPath, 'utf8')));
const OPTIONS = { compilationMode: 'infer', target: '19', environment: {}, lint: true };
const EXT = /\.(jsx?|tsx?)$/;

/** @param {string} name */
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** @param {string} dir @param {string[]} args */
function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr}`);
}

/** Fetch the fixture tests at the pinned commit, and check the licence before anything reads them. */
function fetchFixtures(/** @type {string} */ dir) {
  const { repo: url, commit, dir: sub } = expected.fixtures;
  if (!existsSync(join(dir, '.git'))) {
    spawnSync('git', ['init', '-q', dir]);
    git(dir, ['remote', 'add', 'origin', url]);
  }
  git(dir, ['sparse-checkout', 'set', sub]);
  git(dir, ['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', commit]);
  git(dir, ['checkout', '-q', '--detach', 'FETCH_HEAD']);
  const licence = readFileSync(join(dir, 'LICENSE'), 'utf8');
  assert.match(licence, /^MIT License\n\nCopyright \(c\) Meta Platforms, Inc\. and affiliates\./);
  console.log(`[react-parity] fixtures: ${url} at ${commit.slice(0, 7)} (MIT)`);
}

/**
 * The corpus' files, by their path inside it.
 * @param {string} root
 * @param {(rel: string, text: string) => boolean} keep
 */
function corpus(root, keep) {
  /** @type {Map<string, string>} */
  const files = new Map();
  for (const rel of readdirSync(root, { recursive: true, encoding: 'utf8' }).sort()) {
    const path = rel.split('\\').join('/');
    if (!EXT.test(path) || /(^|\/)(node_modules|storybook-static|\.pxsig)\//.test(path)) continue;
    const text = readFileSync(join(root, rel), 'utf8');
    if (keep(path, text)) files.set(path, text);
  }
  return files;
}

/** @param {Map<string, string>} files */
async function babel(files) {
  const root = join(repo, 'packages/pxsig/test/react-compiler/babel7');
  const at = { root, workspaceRoot: root };
  const b = findPeer(at, '@babel/core');
  const c = findPeer(at, 'babel-plugin-react-compiler');
  assert.ok(b && c, 'the React Compiler test fixtures are not installed');
  assert.equal(`babel-plugin-react-compiler ${c.version}`, expected.babel);
  const env = { ...(await load({ babel: b.path, compiler: c.path })), cwd: root, options: OPTIONS };
  /** @type {Map<string, CompileResult>} */
  const out = new Map();
  for (const [path, text] of files)
    out.set(path, compile(env, { path, text, parser: parserOf(path) }));
  return out;
}

/** @param {string} engine @param {Map<string, string>} files */
function oxc(engine, files) {
  const paths = [...files.keys()];
  const body = {
    options: OPTIONS,
    files: paths.map((p) => ({ path: p, text: files.get(p), parser: parserOf(p) })),
  };
  const r = spawnSync(engine, ['react-compile'], {
    input: JSON.stringify(body),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`react-compile exited ${r.status}: ${r.stderr}`);
  const answer =
    /** @type {{ compiler: { name: string, version: string }, results: CompileResult[] }} */ (
      JSON.parse(r.stdout)
    );
  assert.equal(`${answer.compiler.name} ${answer.compiler.version}`, expected.oxc);
  return new Map(paths.map((p, i) => [p, answer.results[i]]));
}

async function main() {
  const fetchTo = arg('--fetch');
  if (fetchTo) return fetchFixtures(fetchTo);
  const engine = arg('--engine');
  assert.ok(engine, 'usage: react-parity.mjs --engine <pxsig> [--fixtures <dir>] [--update]');
  const fixtures = arg('--fixtures');
  /** @type {Record<string, Map<string, string>>} */
  const corpora = {
    examples: corpus(
      join(repo, 'examples'),
      (p) => /(^|\/)src\//.test(p) && !p.includes('.stories.')
    ),
  };
  if (fixtures) {
    const root = join(fixtures, expected.fixtures.dir);
    corpora.fixtures = corpus(root, (p, t) => !isFlow(p, t));
  }
  /** @type {Record<string, CorpusParity>} */
  const got = {};
  for (const [name, files] of Object.entries(corpora))
    got[name] = compareCorpus(await babel(files), oxc(engine, files));
  const report = table(got, expected);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  if (process.argv.includes('--update')) {
    writeFileSync(
      expectedPath,
      `${JSON.stringify({ ...expected, corpora: { ...expected.corpora, ...got } }, null, 2)}\n`
    );
    return;
  }
  for (const [name, p] of Object.entries(got))
    assert.deepEqual(
      p,
      expected.corpora[name],
      `${name}: the parity report changed; review it and run with --update`
    );
}

await main();
