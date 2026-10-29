/**
 * `pnpm ui:check` on a copy of the dashboard and docs/ui: it passes as committed, and fails when a
 * documented feature is removed, a contract component is added without its documentation, or a
 * design-system import appears outside src/ui/adapters/.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTree } from '../../../scripts/lib/copy-tree.mjs';

const dashboard = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.resolve(dashboard, '..', '..');

/** A copy of the dashboard (no node_modules) and docs/ui, changed by `edit`, then checked. */
async function check(edit = () => {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'pxsig-ui-check-'));
  try {
    const d = path.join(root, 'packages', 'dashboard');
    copyTree(dashboard, d, {
      filter: (p) =>
        !p.includes(`${path.sep}node_modules`) && !p.includes(`${path.sep}test${path.sep}`),
    });
    copyTree(path.join(repo, 'docs', 'ui'), path.join(root, 'docs', 'ui'));
    const file = (rel) => path.join(d, rel);
    edit({
      read: (rel) => readFileSync(file(rel), 'utf8'),
      write: (rel, text) => writeFileSync(file(rel), text),
    });
    const { checkAll } = await import(
      `${pathToFileURL(path.join(d, 'ui-tools.mjs')).href}?${Math.random()}`
    );
    return await checkAll();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('the committed contract, docs and reference adapter agree', async () => {
  assert.deepEqual(await check(), []);
});

test('removing a documented feature fails', async () => {
  const problems = await check(({ read, write }) => {
    const f = read('src/ui/features/review.ts');
    const start = f.indexOf("  {\n    id: 'runs.history',");
    const end = f.indexOf("  {\n    id: 'diagnostics.research',");
    write('src/ui/features/review.ts', f.slice(0, start) + f.slice(end));
  });
  assert.ok(
    problems.includes('src/views/History.tsx belongs to no feature in src/ui/features.ts'),
    problems.join('\n')
  );
  assert.ok(problems.some((p) => /docs\/ui\/features\.md is out of date/.test(p)));
});

test('adding a contract component without its documentation fails', async () => {
  const problems = await check(({ read, write }) => {
    const c = read('src/ui/contract.ts');
    write(
      'src/ui/contract.ts',
      c.replace(
        "  Chart: { group: 'charts'",
        "  Tabs: { group: 'controls', required: false, role: 'tabs' },\n  Chart: { group: 'charts'"
      )
    );
  });
  for (const want of [
    /no section for Tabs/,
    /conformance\.json has no entry for Tabs/,
    /Tabs is in the contract but no feature/,
    /manifest\.json is out of date/,
  ])
    assert.ok(
      problems.some((p) => want.test(p)),
      `${want}\n${problems.join('\n')}`
    );
});

test('a design-system import outside the adapters fails', async () => {
  const problems = await check(({ read, write }) =>
    write(
      'src/views/Help.tsx',
      `import { Thing } from 'some-design-system';\n${read('src/views/Help.tsx')}`
    )
  );
  assert.ok(
    problems.some((p) => /src\/views\/Help\.tsx: imports "some-design-system"/.test(p)),
    problems.join('\n')
  );
});

test('a contract change without a version bump and a changes entry fails', async () => {
  const version = readFileSync(path.join(dashboard, 'src/ui/contract.ts'), 'utf8').match(
    /CONTRACT_VERSION = '([\d.]+)'/
  )[1];
  const [M, m] = version.split('.').map(Number);
  const next = `${M}.${m + 1}.0`;
  const esc = (v) => v.replace(/\./g, '\\.');
  const removed = await check(({ read, write }) =>
    write(
      'src/ui/contract.ts',
      read('src/ui/contract.ts').replace(
        "  Kbd: { group: 'controls', required: false, role: 'a keyboard key' },\n",
        ''
      )
    )
  );
  assert.ok(
    removed.some((p) =>
      new RegExp(
        `Kbd was removed.*CONTRACT_VERSION is still ${esc(version)}: bump it \\(major\\)`
      ).test(p)
    ),
    removed.join('\n')
  );
  const bumped = await check(({ read, write }) =>
    write(
      'src/ui/contract.ts',
      read('src/ui/contract.ts')
        .replace(`CONTRACT_VERSION = '${version}'`, `CONTRACT_VERSION = '${next}'`)
        .replace(
          "  /** A CSS size. Unset: the adapter's default. */\n  size?: string;",
          "  /** A CSS size. Unset: the adapter's default. */\n  size?: string;\n  spin?: boolean;"
        )
    )
  );
  assert.ok(
    bumped.some((p) => new RegExp(`no "## ${esc(next)}" section`).test(p)),
    bumped.join('\n')
  );
  assert.ok(
    bumped.some((p) =>
      new RegExp(`reference adapter: conformance\\.json says "contract": "${esc(version)}"`).test(p)
    ),
    bumped.join('\n')
  );
});
