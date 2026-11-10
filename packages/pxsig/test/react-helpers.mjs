/**
 * react-helpers.mjs — fixture projects for the React analysis tests: a git repository with a
 * component, its story and a manifest, and the React Compiler with Babel 7 or 8 linked in from the
 * test fixture packages (packages/pxsig/test/react-compiler/babel7|babel8, workspace members
 * whose devDependencies they are; pxsig itself does not declare them).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openProject } from '../src/lib/workspace.mjs';
import { tempDir } from './fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
/** @param {7 | 8} major */
export const fixtureModules = (major) =>
  join(here, 'react-compiler', `babel${major}`, 'node_modules');
/** Both fixture packages are installed (`pnpm install` at the repository root). */
export const hasCompiler = [7, 8].every((m) =>
  existsSync(
    join(fixtureModules(/** @type {7 | 8} */ (m)), 'babel-plugin-react-compiler', 'package.json')
  )
);

/**
 * @param {string} dir
 * @param {string[]} args
 */
export function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * @param {string} dir
 * @param {string} rel
 * @param {string} text
 */
export const write = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

/** The component at the merge base: both functions compile. */
export const BASE = `import { useRef, useState } from 'react';
export function Button({ label }) {
  return <button>{label}</button>;
}
export const Card = ({ t }) => {
  const [s] = useState(0);
  return <div>{t}{s}</div>;
};
`;
/** Now: Button reads a ref during render (skipped), Card sets state in an effect (a finding). */
export const HEAD = `import { useEffect, useRef, useState } from 'react';
export function Button({ label }) {
  const r = useRef(0);
  return <button>{label}{r.current}</button>;
}
export const Card = ({ t }) => {
  const [s, setS] = useState(0);
  useEffect(() => {
    setS(1);
  }, []);
  return <div>{t}{s}</div>;
};
`;

/**
 * A project on branch `work`, one commit past `main`, with the compiler linked in (`babel`: 7 or 8)
 * or not (`null`). `config` is laid over pxsig.config.json; `head` is Button.tsx on `work`.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {{ babel?: 7 | 8 | null, config?: Record<string, unknown>, head?: string, folder?: string }} [o]
 */
export function reactProject(t, { babel = 7, config = {}, head = HEAD, folder = 'react' } = {}) {
  const dir = tempDir(folder, t);
  git(dir, ['init', '-q', '-b', 'main']);
  for (const [k, v] of [
    ['user.email', 'test@example.com'],
    ['user.name', 'test'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
  ])
    git(dir, ['config', k, v]);
  write(dir, '.gitignore', 'node_modules\n.pxsig/reports\n.pxsig/cache\n');
  write(
    dir,
    'pxsig.config.json',
    JSON.stringify({
      name: 'react-fixture',
      srcRoot: 'src',
      storybook: { url: 'http://127.0.0.1:1' },
      ...config,
    })
  );
  write(dir, 'src/Button/Button.tsx', BASE);
  write(
    dir,
    'src/Button/Button.stories.tsx',
    "import { Button } from './Button';\nexport default { component: Button };\n"
  );
  write(
    dir,
    '.pxsig/manifest.json',
    JSON.stringify({
      stories: ['primary', 'small'].map((s) => ({
        id: `button--${s}`,
        story: `button--${s}`,
        mode: 'default',
        sig: `.pxsig/baselines/button/button--${s}.psig`,
        importPath: 'src/Button/Button.stories.tsx',
      })),
    })
  );
  if (babel) {
    mkdirSync(join(dir, 'node_modules', '@babel'), { recursive: true });
    const from = fixtureModules(babel);
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(
      join(from, 'babel-plugin-react-compiler'),
      join(dir, 'node_modules', 'babel-plugin-react-compiler'),
      type
    );
    symlinkSync(join(from, '@babel', 'core'), join(dir, 'node_modules', '@babel', 'core'), type);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  git(dir, ['checkout', '-q', '-b', 'work']);
  write(dir, 'src/Button/Button.tsx', head);
  git(dir, ['commit', '-q', '--allow-empty', '-am', 'work']);
  return dir;
}

/**
 * The fixture's Project.
 * @param {string} dir
 * @param {Record<string, unknown>} [flags]
 */
export const projectAt = (dir, flags = {}) =>
  openProject({
    cwd: dir,
    workspace: dir,
    flags,
    env: { ...process.env, PXSIG_WORKSPACE: undefined },
  });
