// Selection (docs/ci.md, "How selection decides"): the run manifest carries what `pxsig affected`
// needs, every changed path gets one class, the fail-safe selects everything and says why, and
// only the gates use it (watch and staleness trace). Temp folders only; no Storybook, no server.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { rustAffected } from '../src/lib/integrity.mjs';
import {
  findWorkspace,
  loadProject,
  openProject,
  writeRunManifest,
} from '../src/lib/workspace.mjs';
import { fixture, hasRust, rustBin, tempDir, testEnv, testHome } from './fixture.mjs';
import { skipUnless } from './strict.mjs';
/** @import { ManifestEntry } from '../src/types.js' */

const src = fileURLToPath(new URL('../src/', import.meta.url));
/**
 * @param {string[]} args
 * @param {string} cwd
 */
const cli = (args, cwd) =>
  spawnSync(process.execPath, [join(src, 'cli.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...testEnv(testHome),
      PXSIG_FORMAT: '',
      PXSIG_URL: 'http://127.0.0.1:1',
      PXSIG_BIN: rustBin,
      PXSIG_WORKSPACE: '',
      PXSIG_PROJECT: '',
    },
  });
/** @param {Record<string, unknown>} files */
const tree = (files) => {
  const root = tempDir('sel');
  mkdirSync(join(root, '.git'));
  for (const [p, v] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof v === 'string' ? v : JSON.stringify(v));
  }
  return root;
};
/**
 * @param {string} repo
 * @param {string} run
 * @param {string[]} files
 */
const affected = (repo, run, files) => {
  const r = spawnSync(
    rustBin,
    ['affected', '--manifest', run, '--root', repo, '--files', files.join(','), '--json'],
    { cwd: repo, encoding: 'utf8' }
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
/**
 * @param {{ files: { path: string, class: string }[] }} a
 * @param {string} path
 */
const classOf = (a, path) => a.files.find((f) => f.path === path)?.class;

test('affects.ignore is anchored like affects.extra, plus $repo/', () => {
  const root = tree({
    'pxsig.workspace.json': {
      projects: { ds: 'packages/ds' },
      defaults: { affects: { ignore: ['docs/**'] } },
    },
    'packages/ds/pxsig.config.json': {
      srcRoot: 'src',
      affects: { ignore: ['notes/', '$workspace/**/*.md', '$repo/other/**'] },
    },
  });
  const ws = findWorkspace({ cwd: root, env: {} });
  const P = loadProject(ws, ws.projects[0], { env: {} });
  assert.deepEqual(
    P.affectsIgnore,
    ['packages/ds/notes/', '**/*.md', '$repo/other/**'],
    'the project list replaces the defaults (arrays replace)'
  );
  const P2 = loadProject(ws, ws.projects[0], { env: { PXSIG_SOURCES: 'shared' } });
  assert.deepEqual(
    P2.affectsIgnore,
    P.affectsIgnore,
    'PXSIG_SOURCES does not touch the ignore list'
  );
  const c = JSON.parse(cli(['config', '--json', '--project', 'ds'], root).stdout);
  assert.deepEqual(c.config.affects.ignore, ['notes/', '$workspace/**/*.md', '$repo/other/**']);
  assert.equal(c.sources['affects.ignore'], 'project config');
  writeFileSync(
    join(root, 'packages/ds/pxsig.config.json'),
    JSON.stringify({ affects: { ignore: 'docs' } })
  );
  assert.throws(
    () => loadProject(ws, ws.projects[0], { env: {} }),
    /affects.ignore must be an array/
  );
});

test('the run manifest carries the store, the ignore list, the workspace file and the Storybook config', () => {
  const f = fixture({ withSigs: false });
  writeFileSync(
    join(f.repo, 'pxsig.config.json'),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(f.repo, 'pxsig.config.json'), 'utf8')),
      storybook: { url: 'http://127.0.0.1:1', configDir: '.storybook' },
      affects: { ignore: ['docs/**'] },
    })
  );
  writeFileSync(join(f.px, 'manifest.matrix.json'), JSON.stringify({ stories: [] }));
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
  const run = JSON.parse(readFileSync(writeRunManifest(P).path, 'utf8'));
  assert.deepEqual(run.affectsIgnore, ['docs/**']);
  assert.ok(
    run.affectsAll.includes('.storybook') && run.affectsAll.includes('pxsig.config.json'),
    run.affectsAll.join()
  );
  assert.deepEqual(run.store, {
    dir: '.pxsig',
    a11y: '.pxsig/a11y.json',
    approvals: '.pxsig/approvals.ndjson',
    a11yDecisions: '.pxsig/a11y-decisions.ndjson',
    manifests: { '': '.pxsig/manifest.json', matrix: '.pxsig/manifest.matrix.json' },
    suite: null,
  });
  assert.equal(
    JSON.parse(readFileSync(writeRunManifest(P, P.manifestPath('matrix')).path, 'utf8')).store
      .suite,
    'matrix'
  );
});

test(
  'baselines, records, the fail-safe and the ignore list, through the engine',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  () => {
    const f = fixture({ withSigs: false });
    const run = writeRunManifest(openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } })).path;
    // The fixture's manifest lists ids.ok.
    const sig = /** @type {ManifestEntry} */ (f.manifest.stories.find((e) => e.id === f.ids.ok))
      .sig;
    let a = affected(f.repo, run, [sig]);
    assert.deepEqual(
      [classOf(a, sig), a.ids, a.baselines, a.all],
      ['baseline', [f.ids.ok], [f.ids.ok], false]
    );
    a = affected(f.repo, run, ['.pxsig/baselines/components/Old/components-old--x.psig']);
    assert.deepEqual(
      [classOf(a, '.pxsig/baselines/components/Old/components-old--x.psig'), a.ids],
      ['baseline-other', []]
    );
    a = affected(f.repo, run, ['.pxsig/a11y.json']);
    assert.deepEqual(
      [a.ids, a.records['.pxsig/a11y.json']],
      [[f.ids.ok], [f.ids.ok]],
      'a record named explicitly selects every entry it names'
    );
    a = affected(f.repo, run, ['README.md', 'src/components/Alpha/Alpha.stories.tsx']);
    assert.equal(a.all, true);
    assert.equal(a.ids.length, f.manifest.stories.length);
    assert.deepEqual(a.failSafe, [
      { path: 'README.md', class: 'outside', why: 'README.md: outside srcRoot' },
    ]);
    assert.deepEqual(
      a.traced.sort(),
      [f.ids.ok, f.ids.drift].sort(),
      'traced leaves the fail-safe out'
    );
    a = affected(f.repo, run, ['src/components/Alpha/notes.md']);
    assert.equal(classOf(a, 'src/components/Alpha/notes.md'), 'untraced');
    writeFileSync(
      join(f.repo, 'pxsig.config.json'),
      JSON.stringify({
        ...JSON.parse(readFileSync(join(f.repo, 'pxsig.config.json'), 'utf8')),
        affects: { ignore: ['**/*.md'] },
      })
    );
    const run2 = writeRunManifest(openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } })).path;
    a = affected(f.repo, run2, ['README.md', 'src/components/Alpha/notes.md']);
    assert.deepEqual(
      [a.all, a.ids, a.ignored],
      [false, [], ['README.md', 'src/components/Alpha/notes.md']]
    );
  }
);

test(
  'summary.md names the fail-safe path only when it fired',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  () => {
    const dir = tempDir('sel-report');
    /** @param {Record<string, unknown>} summary */
    const md = (summary) => {
      writeFileSync(
        join(dir, 'check.json'),
        JSON.stringify({
          summary: { totalMs: 1000, ...summary },
          rows: [{ id: 'a', pass: true, metrics: {} }],
        })
      );
      const r = spawnSync(
        rustBin,
        ['report', '--input', join(dir, 'check.json'), '--format', 'markdown'],
        { encoding: 'utf8' }
      );
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    assert.match(
      md({
        selectAll: {
          entries: 12,
          path: 'docs/x.json',
          class: 'outside',
          why: 'docs/x.json: outside srcRoot',
          more: 2,
        },
      }),
      /All 12 entries selected: `docs\/x.json` \(`outside`\); 2 more reasons in check.json\./
    );
    assert.match(
      md({
        selectAll: {
          entries: 3,
          path: null,
          class: 'no-merge-base',
          why: 'no merge base between main and HEAD: every entry selected',
          more: 0,
        },
      }),
      /All 3 entries selected: no merge base between main and HEAD/
    );
    assert.doesNotMatch(
      md({ affected: '1 affected of 3 (1 story files import a changed file)' }),
      /entries selected/
    );
  }
);

test(
  'the fail-safe is for the gates: staleness traces, `pxsig affected` explains',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture({ withSigs: false });
    // The test is skipped without the binary, so the engine is there.
    const engine = /** @type {NonNullable<ReturnType<typeof rustAffected>>} */ (
      rustAffected(f.ctx)
    );
    try {
      assert.deepEqual(
        await engine.affected('README.md'),
        [],
        'staleness: an untraceable edit makes nothing stale'
      );
      assert.deepEqual(
        (await engine.affected('src/components/Alpha/Alpha.stories.tsx')).sort(),
        [f.ids.ok, f.ids.drift].sort()
      );
    } finally {
      engine.close();
    }
    const r = cli(['affected', 'README.md'], f.repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Every entry selected because of/);
    assert.match(r.stdout, /README\.md: outside srcRoot \(outside\)/);
    assert.match(r.stdout, /affects\.ignore/);
    const j = JSON.parse(
      cli(['affected', join(f.repo, 'src/components/Alpha/Alpha.stories.tsx'), '--json'], f.repo)
        .stdout
    );
    assert.equal(j.all, false, 'an absolute path inside the workspace is made relative');
    assert.equal(j.entries, 2);
  }
);

test('affects.aliases and affects.unresolved: anchored, validated, shown by `pxsig config`, carried to the engine', () => {
  const root = tree({
    'pxsig.workspace.json': { projects: { ds: 'packages/ds' } },
    'packages/ds/pxsig.config.json': {
      srcRoot: 'src',
      affects: {
        aliases: { '@ds': 'src', '@tokens': '$workspace/packages/tokens/src' },
        unresolved: ['.storybook/main.ts', '$workspace/apps/**'],
      },
    },
  });
  const ws = findWorkspace({ cwd: root, env: {} });
  const P = loadProject(ws, ws.projects[0], { env: {} });
  assert.deepEqual(P.affectsAliases, {
    '@ds': 'packages/ds/src',
    '@tokens': 'packages/tokens/src',
  });
  assert.deepEqual(P.affectsUnresolved, ['packages/ds/.storybook/main.ts', 'apps/**']);
  const c = JSON.parse(cli(['config', '--json', '--project', 'ds'], root).stdout);
  assert.deepEqual(Object.keys(c.config.affects.aliases), ['@ds', '@tokens']);
  assert.equal(c.sources['affects.unresolved'], 'project config');
  writeFileSync(
    join(root, 'packages/ds/pxsig.config.json'),
    JSON.stringify({ affects: { aliases: ['src'] } })
  );
  assert.throws(() => loadProject(ws, ws.projects[0], { env: {} }), /affects.aliases must map/);
  writeFileSync(
    join(root, 'packages/ds/pxsig.config.json'),
    JSON.stringify({ affects: { unresolved: 'x' } })
  );
  assert.throws(
    () => loadProject(ws, ws.projects[0], { env: {} }),
    /affects.unresolved must be an array/
  );
});

test(
  'non-code imports are followed, and an unresolved import is listed and checked on every run',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  () => {
    const f = fixture({ withSigs: false });
    const alpha = 'src/components/Alpha/Alpha.stories.tsx';
    writeFileSync(
      join(f.repo, alpha),
      `import data from './alpha.json';\nimport s from 'virtual:status';\n${readFileSync(join(f.repo, alpha), 'utf8')}`
    );
    writeFileSync(join(f.repo, 'src/components/Alpha/alpha.json'), '{}');
    const run = () =>
      writeRunManifest(openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } })).path;
    let a = affected(f.repo, run(), ['src/components/Alpha/alpha.json']);
    assert.deepEqual([classOf(a, 'src/components/Alpha/alpha.json'), a.all], ['graph', false]);
    assert.deepEqual(
      a.unresolved.map(
        (/** @type {{ file: string, spec: string, accepted: boolean, selects: string }} */ u) => [
          u.file,
          u.spec,
          u.accepted,
          u.selects,
        ]
      ),
      [[alpha, 'virtual:status', false, 'entries']]
    );
    const r = cli(['affected', 'src/components/Alpha/alpha.json'], f.repo);
    assert.match(r.stdout, /Checked on every run: unresolved imports/);
    assert.match(r.stdout, /virtual:status/);
    writeFileSync(
      join(f.repo, 'pxsig.config.json'),
      JSON.stringify({
        ...JSON.parse(readFileSync(join(f.repo, 'pxsig.config.json'), 'utf8')),
        affects: { unresolved: ['src/components/Alpha/**'] },
      })
    );
    a = affected(f.repo, run(), ['README.md']);
    assert.deepEqual([a.unresolved[0].accepted, a.unresolved[0].selects], [true, 'none']);
  }
);
