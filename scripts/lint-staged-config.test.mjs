// lint-staged.config.mjs: which commands the pre-commit hook runs for a set of staged files.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import config from '../lint-staged.config.mjs';

const code = config['*.{ts,tsx,js,jsx,mjs,cjs}'];

test('a commit of only .d.ts files runs oxfmt, not oxlint (which ignores them)', () => {
  const cmds = code(['/r/packages/pxsig/src/types.d.ts', '/r/packages/pxsig/src/types/run.d.ts']);
  assert.equal(cmds.length, 1);
  assert.match(cmds[0], /^pnpm exec oxfmt /);
});

test('oxlint gets every file it lints, and none it ignores', () => {
  const cmds = code([
    '/r/packages/pxsig/src/a.mjs',
    '/r/packages/pxsig/src/types.d.ts',
    'C:\\r\\packages\\pxsig\\dashboard\\x.js',
  ]);
  const lint = cmds.find((c) => c.startsWith('pnpm exec oxlint '));
  assert.equal(lint, 'pnpm exec oxlint --type-aware "/r/packages/pxsig/src/a.mjs"');
});

test('nothing to lint or format runs nothing', () => {
  assert.deepEqual(code(['/r/packages/pxsig/dashboard/x.js']), []);
});
