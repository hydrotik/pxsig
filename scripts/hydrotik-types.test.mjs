import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { adapterImports, typesFile } from './lib/hydrotik-types.mjs';

test('reads named, namespace and side-effect imports, and only the narrowed members', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pxsig-ds-types-'));
  try {
    writeFileSync(
      path.join(dir, 'a.tsx'),
      [
        "import '@hydrotik/design-system/fonts';",
        "import * as DS from '@hydrotik/design-system';",
        "import { Bar, BarChart as RBar } from 'recharts';",
        "import type { X } from 'somewhere-else';",
        'export const a = <DS.Card><DS.Icons.Sun /><DS.Icons.Moon /></DS.Card>;',
      ].join('\n')
    );
    writeFileSync(path.join(dir, 'b.css.ts'), "import { vars } from '@hydrotik/tokens';\n");
    writeFileSync(path.join(dir, 'c.d.ts'), "import { Nope } from '@hydrotik/tokens';\n");
    const got = Object.fromEntries(
      [...adapterImports(dir)].map(([spec, names]) => [
        spec,
        Object.fromEntries([...names].map(([n, m]) => [n, [...m].sort()])),
      ])
    );
    assert.deepEqual(got, {
      '@hydrotik/design-system/fonts': {},
      '@hydrotik/design-system': { Card: [], Icons: ['Moon', 'Sun'] },
      recharts: { Bar: [], BarChart: [] },
      '@hydrotik/tokens': { vars: [] },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the committed declarations cover every name the reference adapter imports', () => {
  const text = readFileSync(typesFile, 'utf8');
  for (const [spec, names] of adapterImports()) {
    const block = new RegExp(`^declare module '${spec}' \\{([^}]*)\\}`, 'm').exec(text);
    assert.ok(block, `${spec} is declared (node scripts/ui.mjs types)`);
    for (const name of names.keys())
      assert.match(block[1], new RegExp(`\\bas ${name}\\b`), `${spec} declares ${name}`);
  }
});
