// patches/picomatch@4.0.7.patch (GHSA-fc5q-39xc-vjpf): every install that resolves picomatch gets
// the patched copy, and the advisory's single-branch repeated extglobs finish quickly on it.
// See patches/README.md. Remove this test with the patch once picomatch releases a fix.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PATCH = 'patches/picomatch@4.0.7.patch';
const EXAMPLES = ['custom-ui', 'monorepo', 'single-package'];

/** The advisory's pattern class with a failing input that backtracks on unpatched 4.0.7 (n=28). */
const n = 28;
const CASES = [
  ['+(*a)', 'a'.repeat(n) + '!'],
  ['*(*a)', 'a'.repeat(n) + '!'],
  ['+(*)', 'a'.repeat(n) + '/'],
  ['*(*)', 'a'.repeat(n) + '/'],
  ['+(a*)', 'a'.repeat(n) + '/'],
  ['*(a*)', 'a'.repeat(n) + '/'],
  ['+(*?)', 'a'.repeat(n) + '/'],
  ['+(*[ab])', 'a'.repeat(n) + '!'],
  ['+(*a)b', 'a'.repeat(n) + '!'],
  ['+(@(a)*)', 'a'.repeat(n) + '/'],
  ['+(*a|b)', 'a'.repeat(n) + '!'],
];
const LIMIT_MS = 100;

/**
 * Time every case against the picomatch at `dir`, in a child process: an unpatched copy runs for
 * minutes, and the timeout turns that into a failure instead of a hung test run.
 * @param {string} dir
 * @returns {Record<string, number>} milliseconds per pattern
 */
const time = (dir) => {
  const script = `const pm = require(${JSON.stringify(dir)}); const out = {};
for (const [p, s] of ${JSON.stringify(CASES)}) {
  const t = process.hrtime.bigint(); pm.isMatch(s, p);
  out[p] = Number(process.hrtime.bigint() - t) / 1e6;
  if (out[p] > ${LIMIT_MS}) break;
}
console.log(JSON.stringify(out));`;
  const out = execFileSync(process.execPath, ['-e', script], { timeout: 20_000, encoding: 'utf8' });
  return JSON.parse(out);
};

/**
 * The picomatch a package resolves, from that package's own folder (as Node resolves it).
 * @param {string} from  a package.json path
 * @param {string[]} chain  package names to walk through first
 */
const resolveVia = (from, chain) => {
  let base = from;
  for (const name of chain) base = createRequire(base).resolve(`${name}/package.json`);
  return dirname(createRequire(base).resolve('picomatch/package.json'));
};

/** @param {string} dir */
const assertFast = (dir) => {
  const ms = time(dir);
  for (const [p] of CASES) {
    assert.ok(p in ms, `${p}: not reached (an earlier pattern was too slow)`);
    assert.ok(ms[p] < LIMIT_MS, `${p}: ${ms[p].toFixed(0)} ms (limit ${LIMIT_MS} ms) in ${dir}`);
  }
};

/** @param {string} dir */
const assertPatched = (dir) => assert.match(dir, /picomatch@4\.0\.7_patch_hash=/, dir);

test('root: lint-staged and the dashboard build resolve the patched picomatch', () => {
  const pj = join(root, 'package.json');
  const dash = join(root, 'packages/dashboard/package.json');
  const dirs = new Set([
    resolveVia(pj, ['lint-staged']),
    resolveVia(dash, ['vite']),
    resolveVia(dash, ['vite', 'tinyglobby']),
    resolveVia(dash, ['vite', 'tinyglobby', 'fdir']),
  ]);
  for (const dir of dirs) assertFast(dir);
  for (const dir of dirs) assertPatched(dir);
});

test('every example declares the same patch as the root', () => {
  const want = readFileSync(join(root, PATCH));
  for (const name of EXAMPLES) {
    const dir = join(root, 'examples', name);
    const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.equal(pj.pnpm?.patchedDependencies?.['picomatch@4.0.7'], PATCH, name);
    assert.deepEqual(
      readFileSync(join(dir, PATCH)),
      want,
      `${name}: ${PATCH} differs from the root's`
    );
    assert.match(
      readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8'),
      /picomatch@4\.0\.7\(patch_hash=/
    );
  }
});

test('an installed example resolves the patched picomatch', (t) => {
  const installed = EXAMPLES.filter((name) =>
    existsSync(join(root, 'examples', name, 'node_modules/.pnpm'))
  );
  if (!installed.length) return t.skip('no example is installed here');
  for (const name of installed) {
    // pnpm links every package of the install here, so this is the copy its tools resolve.
    const dir = realpathSync(
      join(root, 'examples', name, 'node_modules/.pnpm/node_modules/picomatch')
    );
    assertFast(dir);
    assertPatched(dir);
  }
});
