/**
 * fixture.mjs — a throwaway single-package project for the tests: story files, a manifest, `.psig`
 * baselines (real ones when the Rust binary is built), renders and a report. Nothing here touches
 * a real repository.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { after } from 'node:test';
import { deflateSync } from 'node:zlib';
import { resolveContext, scanStories } from '../src/lib/integrity.mjs';
import { readHeader, readSection } from '../src/lib/psig.mjs';
import { openProject, rustBinary } from '../src/lib/workspace.mjs';

/** @import { Manifest, ManifestEntry, StoryIndex, CheckRow } from '../src/types.js' */

export const rustBin = rustBinary();
export const hasRust = existsSync(rustBin);

// --- temp folders and the environment a spawned pxsig sees ------------------------------------------
/**
 * Every temp folder's name has a space and a non-ASCII letter, so each OS runs the suite on paths like
 * a real profile's (`C:\Users\José Núñez\…`).
 */
export const TEMP_PREFIX = 'pxsig dir é-';

/** @type {string[]} */
const made = [];
/** @param {string} dir */
const remove = (dir) => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    // A folder a stray child still holds (Windows): left in the temp folder, said, not a failure.
    process.stderr.write(`could not remove ${dir}: ${String(e)}\n`);
  }
};
// The folders made without a test context (at a file's top level): removed when the file's tests end.
// Each test file is its own process, so this runs once per file.
after(() => {
  for (const dir of made.splice(0)) remove(dir);
});

/**
 * A new temp folder, removed after `t` (or after the file's tests, without one).
 * @param {string} [name] a word in the folder name, for a reader of a failure
 * @param {{ after: (fn: () => void) => void }} [t] the test context
 */
export function tempDir(name = 'tmp', t) {
  const dir = mkdtempSync(join(tmpdir(), `${TEMP_PREFIX}${name}-`));
  if (t) t.after(() => remove(dir));
  else made.push(dir);
  return dir;
}

/**
 * Where Playwright finds its browsers for this user (its own default), so a process whose home
 * folder is moved still finds the Chromium `playwright install` put there.
 */
function playwrightBrowsers() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  const home = homedir();
  if (process.platform === 'win32')
    return join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'ms-playwright');
  if (process.platform === 'darwin') return join(home, 'Library', 'Caches', 'ms-playwright');
  return join(process.env.XDG_CACHE_HOME || join(home, '.cache'), 'ms-playwright');
}
const BROWSERS = playwrightBrowsers();

/** The per-user folders pxsig reads (lib/machine.mjs), and where each goes under a test's home. */
const HOME_VARS = /** @type {const} */ ([
  ['HOME', ''],
  ['USERPROFILE', ''],
  ['LOCALAPPDATA', 'AppData/Local'],
  ['XDG_CONFIG_HOME', '.config'],
  ['XDG_STATE_HOME', '.local/state'],
]);
/**
 * @param {string} home
 * @returns {Record<string, string>}
 */
const homeVars = (home) => ({
  ...Object.fromEntries(
    HOME_VARS.map(([k, sub]) => [k, sub ? join(home, ...sub.split('/')) : home])
  ),
  PLAYWRIGHT_BROWSERS_PATH: BROWSERS,
});

/**
 * This test file's home folder. The test process uses it too (set below), so what a test reads in
 * process (`readToken`, `readSettings`) is what the pxsig it started wrote: on Windows the server's
 * token files live under `%LOCALAPPDATA%`, not beside the project.
 */
export const testHome = tempDir('home');
Object.assign(process.env, homeVars(testHome));

/**
 * This process's environment for a spawned pxsig (the CLI, `pxsig serve`, the MCP server), with
 * every per-user folder under `home`: the server's tokens, state and settings land there, never in
 * the real `%LOCALAPPDATA%\pxsig` or `~/.local/state/pxsig`. `extra` is laid over the result.
 * @param {string} home a temp folder: `testHome`, unless a test needs its own (`tempDir`)
 * @param {Record<string, string | undefined>} [extra]
 * @returns {Record<string, string | undefined>}
 */
export function testEnv(home, extra = {}) {
  /** @type {Set<string>} */
  const names = new Set(HOME_VARS.map(([k]) => k));
  // Windows names are case-insensitive: drop `LocalAppData` too, so only the value set here remains.
  /** @type {Record<string, string | undefined>} */
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !names.has(k.toUpperCase()))
  );
  return Object.assign(env, homeVars(home), extra);
}

// --- PNG fixtures (no dependencies) -----------------------------------------------------------------
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** @param {Buffer} buf */
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/**
 * @param {string} type
 * @param {Buffer} data
 */
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/**
 * A w×h RGBA PNG; `px(x, y)` → [r, g, b].
 * @param {number} w
 * @param {number} h
 * @param {(x: number, y: number) => number[]} px
 */
export function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      raw.set([r, g, b, 255], y * (w * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export const CHECKER = png(128, 128, (x, y) =>
  ((x >> 4) + (y >> 4)) % 2 ? [230, 230, 230] : [40, 60, 90]
);
export const BROKEN = png(128, 128, (x, y) =>
  x > 24 && x < 104 && y > 24 && y < 104
    ? [220, 20, 20]
    : ((x >> 4) + (y >> 4)) % 2
      ? [230, 230, 230]
      : [40, 60, 90]
);

// --- fixture repo -----------------------------------------------------------------------------------------
/**
 * @param {string} title
 * @param {string[]} exports
 */
export const STORY = (title, exports) =>
  `import type { Meta, StoryObj } from '@storybook/react';\nconst meta = { title: '${title}', component: () => null } satisfies Meta;\nexport default meta;\ntype Story = StoryObj<typeof meta>;\n${exports.map((e) => `export const ${e}: Story = {};`).join('\n')}\n// export const Commented: Story = {};\n`;

/**
 * A `.psig` with a header only, for tests that don't run the Rust engine (`hasImage` reads headers).
 * @param {string} id
 * @param {{ image: boolean }} opts
 */
function fakePsig(id, { image }) {
  const header = Buffer.from(
    JSON.stringify({
      format: 'psig',
      container: 1,
      entry: { id },
      record: {},
      encryption: 'none',
      sections: [
        { name: 'sig', length: 0, sha256: '' },
        ...(image ? [{ name: 'image', type: 'image/png', length: 0, sha256: '' }] : []),
      ],
    })
  );
  const pre = Buffer.alloc(10);
  pre.write('PSIG', 0, 'latin1');
  pre.writeUInt16LE(1, 4);
  pre.writeUInt32LE(header.length, 6);
  return Buffer.concat([pre, header]);
}

/**
 * repo/  (a single-package project: the workspace is the project; its path has a space and an `é`)
 *   pxsig.config.json
 *   src/components/{Alpha,Beta,Gamma,Delta}/*.stories.tsx, src/internal/Helpers/Helpers.stories.tsx
 *   .pxsig/{manifest.json, baselines/, renders/latest, reports/, a11y.json}
 *   node_modules/@storybook/react (a stub, so the stories' package import resolves)
 * Also `env`, `testEnv(testHome)`: what a spawned pxsig is given.
 * @param {{ withSigs?: boolean, t?: { after: (fn: () => void) => void } }} [opts] `t`: remove the
 *   folders after that test (otherwise after the file's tests)
 */
export function fixture({ withSigs = hasRust, t: context } = {}) {
  const repo = tempDir('repo', context);
  mkdirSync(join(repo, '.git'));
  const px = join(repo, '.pxsig');
  /**
   * @param {string} p
   * @param {string | Buffer} data
   */
  const w = (p, data) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, data));
  // Installed, as in a real project: the stories' one package import resolves (external).
  w(join(repo, 'node_modules/@storybook/react/package.json'), '{"name":"@storybook/react"}');
  w(
    join(repo, 'src/components/Alpha/Alpha.stories.tsx'),
    STORY('Components/Alpha', ['Default', 'WithIcon'])
  );
  w(
    join(repo, 'src/components/Beta/Beta.stories.tsx'),
    STORY('Components/Beta', ['Default', 'Flaky', 'Broken', 'Fresh'])
  );
  w(
    join(repo, 'src/components/Gamma/Gamma.stories.tsx'),
    STORY('Components/Gamma', ['Restorable', 'Changed', 'NewOne', 'Never', 'NoRender'])
  );
  w(
    join(repo, 'src/components/Delta/Delta.stories.tsx'),
    STORY('Components/Delta', ['Unbaselined', 'A11y', 'Legacy', 'Quiet'])
  );
  w(join(repo, 'src/internal/Helpers/Helpers.stories.tsx'), STORY('Internal/Helpers', ['Default']));
  const config = {
    name: 'fixture',
    srcRoot: 'src',
    nonVisual: ['internal'],
    storybook: { url: 'http://127.0.0.1:1' },
    grid: 16,
    minCellPx: null,
    detail: false,
    modes: { dark: { globals: 'theme:dark', colorScheme: 'dark' } },
    gate: { threshold: 24, minCells: 3, minSsim: 0.99, maxChangedPct: 2 },
    integrity: { renderSkewMs: 60_000 },
  };
  w(join(repo, 'pxsig.config.json'), JSON.stringify(config, null, 2));
  /**
   * @param {string} id
   * @param {string} folder
   * @returns {ManifestEntry}
   */
  const entry = (id, folder) => ({
    id,
    story: id,
    mode: 'dark',
    state: null,
    sig: `.pxsig/baselines/components/${folder}/${id}${id === 'components-delta--legacy' ? '.pxsig.json' : '.psig'}`,
    importPath: `src/components/${folder}/${folder}.stories.tsx`,
    globals: 'theme:dark',
    colorScheme: 'dark',
    viewport: [900, 600],
    browser: 'chromium',
    a11y: true,
  });
  const ids = {
    ok: 'components-alpha--default',
    drift: 'components-alpha--with-icon',
    changed: 'components-beta--default',
    flaky: 'components-beta--flaky',
    error: 'components-beta--broken',
    stale: 'components-beta--fresh',
    restorable: 'components-gamma--restorable',
    unrecoverable: 'components-gamma--changed',
    never: 'components-gamma--never',
    noRender: 'components-gamma--no-render',
    unbaselined: 'components-delta--unbaselined',
    a11y: 'components-delta--a-11-y',
    legacy: 'components-delta--legacy',
    quiet: 'components-delta--quiet',
    gone: 'components-omega--renamed',
    unregistered: 'components-gamma--new-one',
  };
  /** @param {string} id */
  const folder = (id) =>
    /** @type {Record<string, string>} */ ({
      alpha: 'Alpha',
      beta: 'Beta',
      gamma: 'Gamma',
      delta: 'Delta',
      omega: 'Omega',
    })[id.split('--')[0].split('-')[1]];
  const manifestIds = Object.entries(ids)
    .filter(([k]) => k !== 'unregistered')
    .map(([, id]) => id);
  /** @type {Manifest} */
  const manifest = {
    version: 2,
    project: 'fixture',
    skipped: [],
    stories: manifestIds.map((id) => entry(id, folder(id))),
  };
  w(join(px, 'manifest.json'), JSON.stringify(manifest, null, 2));
  /** @param {string} id */
  const latest = (id) => join(px, 'renders', 'latest', `${id}.png`);
  /** @param {string} id */
  const sig = (id) => join(repo, entry(id, folder(id)).sig);
  const noImage = [ids.restorable, ids.unrecoverable, ids.never];
  for (const id of manifestIds) {
    if (id !== ids.unbaselined) {
      if (withSigs) {
        w(join(repo, '.tmp', `${id}.png`), CHECKER);
        const json = join(repo, '.tmp', `${id}.pxsig.json`);
        let r = spawnSync(
          rustBin,
          ['capture', join(repo, '.tmp', `${id}.png`), '--out', json, '--grid', '16'],
          { encoding: 'utf8' }
        );
        assert.equal(r.status, 0, r.stderr);
        mkdirSync(dirname(sig(id)), { recursive: true });
        if (id === ids.legacy) cpSync(json, sig(id));
        else {
          const args = ['pack', json, '--out', sig(id), '--entry', JSON.stringify({ id })];
          if (!noImage.includes(id)) args.push('--image', join(repo, '.tmp', `${id}.png`));
          r = spawnSync(rustBin, args, { encoding: 'utf8' });
          assert.equal(r.status, 0, r.stderr);
        }
      } else if (id === ids.legacy) w(sig(id), JSON.stringify({ version: 1, legacy: true }));
      else w(sig(id), fakePsig(id, { image: !noImage.includes(id) }));
    }
    if (id !== ids.noRender) w(latest(id), id === ids.unrecoverable ? BROKEN : CHECKER);
  }
  // Renders predate every verdict (so none reads as "rewritten after its verdict").
  const old = new Date(Date.now() - 3 * 3_600_000);
  for (const n of readdirSync(join(px, 'renders', 'latest')))
    utimesSync(join(px, 'renders', 'latest', n), old, old);
  // An orphan baseline (a story renamed long ago).
  w(
    join(px, 'baselines', 'components', 'Old', 'components-old--x.psig'),
    fakePsig('components-old--x', { image: true })
  );
  // The report: one row per checked entry; `never` and `unbaselined` are absent.
  const now = Date.now();
  const at = new Date(now).toISOString();
  /**
   * @param {string} id
   * @param {Partial<CheckRow>} [extra]
   * @returns {CheckRow}
   */
  const row = (id, extra = {}) => ({
    id,
    story: id,
    mode: 'dark',
    state: null,
    pass: true,
    metrics: { ssim: 1 },
    reasons: [],
    checkedAt: at,
    a11y: { violations: [], new: 0 },
    ...extra,
  });
  const rows = [
    row(ids.ok),
    row(ids.drift, { metrics: { ssim: 0.995 } }),
    row(ids.changed, { pass: false, metrics: { ssim: 0.8 }, reasons: ['ssim 0.8 < min 0.99'] }),
    row(ids.flaky, { pass: true, flaky: true, retry: { attempt: 1 } }),
    row(ids.error, { pass: false, error: 'locator.click: Timeout 5000ms exceeded' }),
    row(ids.stale, { checkedAt: new Date(now - 3_600_000).toISOString() }),
    row(ids.restorable),
    row(ids.unrecoverable),
    row(ids.noRender),
    row(ids.a11y, { a11y: { violations: [{ id: 'color-contrast' }], new: 1 } }),
    row(ids.gone),
    row(ids.legacy),
    // Left out of a --since run as unaffected, with no earlier verdict to carry forward.
    {
      id: ids.quiet,
      story: ids.quiet,
      mode: 'dark',
      state: null,
      skipped: true,
      pass: true,
      metrics: null,
      inherited: false,
      unaffected: true,
    },
  ];
  w(
    join(px, 'reports', 'check.json'),
    JSON.stringify({ generatedAt: new Date(now - 7_200_000).toISOString(), summary: {}, rows })
  );
  w(join(px, 'a11y.json'), JSON.stringify({ [ids.ok]: [] }));
  // Source freshness: Beta's story file was edited after `stale`'s verdict, before the others'.
  const t = new Date(now - 1_800_000);
  for (const f of ['Alpha', 'Beta', 'Gamma', 'Delta'])
    utimesSync(join(repo, `src/components/${f}/${f}.stories.tsx`), t, t);
  utimesSync(join(repo, 'src/internal/Helpers/Helpers.stories.tsx'), t, t);
  const P = openProject({ cwd: repo, env: { PXSIG_BIN: rustBin } });
  const ctx = resolveContext(P);
  // The live index: every story on disk except the renamed one (static scan gives the same set).
  /** @type {StoryIndex} */
  const index = {
    source: 'storybook',
    storybook: { url: 'http://test/index.json', reachable: true, healthy: true },
    stories: scanStories(ctx),
  };
  // Import graph stand-in: a story file affects the entries of its own stories.
  /** @param {string} file */
  const affected = async (file) =>
    manifest.stories.filter((e) => e.importPath === file).map((e) => e.id);
  /** @param {string} id */
  const hasBaseImage = (id) =>
    readHeader(sig(id))?.sections?.some((x) => x.name === 'image') ?? false;
  const env = testEnv(testHome);
  return { repo, env, px, ctx, ids, index, affected, latest, sig, manifest, hasBaseImage };
}

/**
 * Every signature section in the store, hashed: repairs may add images, never change a signature.
 * @param {string} dir
 */
export const hashSignatures = (dir) => {
  const h = createHash('sha256');
  /** @param {string} d */
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else
        h.update(`${relative(dir, p)}\0`).update(
          n.endsWith('.psig') ? (readSection(p, 'sig') ?? readFileSync(p)) : readFileSync(p)
        );
    }
  };
  walk(dir);
  return h.digest('hex');
};
/** @param {string} dir */
export const hashTree = (dir) => {
  const h = createHash('sha256');
  /** @param {string} d */
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(`${relative(dir, p)}\0`).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
};
