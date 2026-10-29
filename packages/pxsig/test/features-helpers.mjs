// What the features tests share: the src path, a clean environment, a file-tree writer, the node
// and pxsig CLI runners, and the two-project and clean-project fixtures.
import { spawnSync } from 'node:child_process';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKER, rustBin, tempDir, testEnv, testHome } from './fixture.mjs';

export const src = fileURLToPath(new URL('../src/', import.meta.url));
/** @type {NodeJS.ProcessEnv} */
export const env = {};
/** @param {Record<string, unknown>} files */
export const tree = (files) => {
  const root = tempDir('feat');
  mkdirSync(join(root, '.git'));
  for (const [p, v] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(
      join(root, p),
      typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)
    );
  }
  return root;
};
/**
 * @param {string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [extra]
 */
export const node = (args, cwd, extra = {}) =>
  spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...testEnv(testHome),
      PXSIG_FORMAT: '',
      PXSIG_URL: 'http://127.0.0.1:1',
      PXSIG_BIN: rustBin,
      PXSIG_WORKSPACE: '',
      PXSIG_PROJECT: '',
      ...extra,
    },
  });
/**
 * @param {string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [extra]
 */
export const cli = (args, cwd, extra) => node([join(src, 'cli.mjs'), ...args], cwd, extra);

export function twoProjects() {
  /**
   * @param {string} id
   * @param {boolean} pass
   */
  const row = (id, pass) => ({
    id,
    story: id,
    mode: 'default',
    pass,
    metrics: { ssim: pass ? 1 : 0.5 },
    reasons: pass ? [] : ['gate'],
    checkedAt: new Date().toISOString(),
  });
  /**
   * @param {string} name
   * @param {string[]} ids
   */
  const proj = (name, ids) => ({
    [`packages/${name}/pxsig.config.json`]: { storybook: { url: 'http://127.0.0.1:1' } },
    [`packages/${name}/.pxsig/manifest.json`]: {
      version: 2,
      stories: ids.map((id) => ({
        id,
        story: id,
        sig: `packages/${name}/.pxsig/baselines/${id}.psig`,
      })),
    },
    [`packages/${name}/.pxsig/reports/check.json`]: {
      generatedAt: new Date().toISOString(),
      summary: {},
      rows: ids.map((id, i) => row(id, i === 0)),
    },
  });
  return tree({
    'pxsig.workspace.json': { projects: { ui: 'packages/ui', forms: 'packages/forms' } },
    ...proj('ui', ['ui-button--a', 'ui-button--b']),
    ...proj('forms', ['forms-field--a']),
  });
}

/** @param {{ quiet?: boolean }} [opts] */
export function cleanProject({ quiet = false } = {}) {
  /** @param {string} id */
  const fake = (id) => {
    const header = Buffer.from(
      JSON.stringify({
        format: 'psig',
        container: 1,
        entry: { id },
        record: {},
        encryption: 'none',
        sections: [
          { name: 'sig', length: 0, sha256: '' },
          { name: 'image', type: 'image/png', length: 0, sha256: '' },
        ],
      })
    );
    const pre = Buffer.alloc(10);
    pre.write('PSIG', 0, 'latin1');
    pre.writeUInt16LE(1, 4);
    pre.writeUInt32LE(header.length, 6);
    return Buffer.concat([pre, header]);
  };
  const ids = ['c-a--one', 'c-a--two'];
  const now = new Date().toISOString();
  const rows = [
    {
      id: ids[0],
      story: ids[0],
      pass: true,
      metrics: { ssim: 0.995 },
      reasons: [],
      checkedAt: now,
    },
    quiet
      ? {
          id: ids[1],
          story: ids[1],
          skipped: true,
          pass: true,
          metrics: null,
          inherited: false,
          unaffected: true,
        }
      : {
          id: ids[1],
          story: ids[1],
          pass: true,
          metrics: { ssim: 1 },
          reasons: [],
          checkedAt: now,
        },
  ];
  const root = tree({
    'pxsig.config.json': { name: 'clean', storybook: { url: 'http://127.0.0.1:1' } },
    'src/A/A.stories.tsx':
      "export default { title: 'C/A' };\nexport const One = {};\nexport const Two = {};\n",
    '.pxsig/manifest.json': {
      version: 2,
      stories: ids.map((id) => ({
        id,
        story: id,
        sig: `.pxsig/baselines/A/${id}.psig`,
        importPath: 'src/A/A.stories.tsx',
      })),
    },
    '.pxsig/reports/check.json': { generatedAt: now, summary: {}, rows },
    ...Object.fromEntries(ids.map((id) => [`.pxsig/baselines/A/${id}.psig`, fake(id)])),
    ...Object.fromEntries(ids.map((id) => [`.pxsig/renders/latest/${id}.png`, CHECKER])),
  });
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(join(root, 'src/A/A.stories.tsx'), old, old);
  for (const id of ids) utimesSync(join(root, `.pxsig/renders/latest/${id}.png`), old, old);
  return root;
}
