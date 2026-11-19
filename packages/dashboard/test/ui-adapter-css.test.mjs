/**
 * The reference adapter maps props only (ui-tools/adapter-css.mjs): the committed adapter passes,
 * and an adapter that declares styles, loads its own stylesheet, draws a <style> element or sets a
 * look in an inline style fails, naming the file and what it sets. Layout glue passes.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { adapterCssProblems, objectKeys } from '../ui-tools/adapter-css.mjs';

const dashboard = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The problems of an adapter folder holding `files`. */
function problemsOf(
  /** @type {Record<string, string>} */ files,
  /** @type {Record<string, string>} */ exceptions = {}
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pxsig-adapter-css-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
    return adapterCssProblems(dir, dir, exceptions);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the committed reference adapter maps props only', () => {
  assert.deepEqual(adapterCssProblems(path.join(dashboard, 'src/ui/adapters/hydrotik')), []);
});

test('the design system’s own stylesheets and layout glue pass', () => {
  assert.deepEqual(
    problemsOf({
      'index.tsx': [
        "import '@hydrotik/design-system/fonts';",
        "import './base.css';",
        'export const A = ({ w, h }) => <DS.Select style={{ inlineSize: w }} />;',
        'export const B = ({ h }) => <DS.Chart style={{ blockSize: h, flexGrow: 1 }} />;',
        'export const C = (w) => ({ ...(w ? { style: { inlineSize: w } } : {}) });',
      ].join('\n'),
      'base.css.ts':
        "import { applyBaseStyles, classPrefixScope } from '@hydrotik/design-system/styles/scoped';\napplyBaseStyles(classPrefixScope('ds-'));\n",
    }),
    []
  );
});

test('styles of its own fail: vanilla-extract, a stylesheet, a <style>, a look inline', () => {
  const problems = problemsOf({
    'index.tsx': [
      "import './tones.css';",
      "import './own.css';",
      'export const A = () => <DS.Alert style={{ boxSizing: "border-box", color: "red" }} />;',
      'export const B = (s) => <DS.Badge style={s} />;',
      'export const C = () => <style>{".x{}"}</style>;',
    ].join('\n'),
    'tones.css.ts':
      "import { globalStyle } from '@vanilla-extract/css';\nimport { vars } from '../../tokens';\nglobalStyle('[data-tone]', { color: 'red' });\n",
  });
  for (const want of [
    /index\.tsx: loads the stylesheet \.\/own\.css/,
    /index\.tsx: an inline style sets boxSizing/,
    /index\.tsx: an inline style sets color/,
    /index\.tsx: an inline style sets \.\.\.s/,
    /index\.tsx: draws a <style> element/,
    /tones\.css\.ts: imports @vanilla-extract\/css/,
    /tones\.css\.ts: imports \.\.\/\.\.\/tokens/,
  ])
    assert.ok(
      problems.some((p) => want.test(p)),
      `${want}\n${problems.join('\n')}`
    );
  assert.equal(problems.length, 7, problems.join('\n'));
});

test('a listed exception is skipped while it exists, and a problem once it is gone', () => {
  const sheet = "import { style } from '@vanilla-extract/css';\nexport const x = style({});\n";
  assert.deepEqual(problemsOf({ 'own.css.ts': sheet }, { 'own.css.ts': 'waits on the DS' }), []);
  assert.match(
    problemsOf({ 'index.tsx': '' }, { 'own.css.ts': 'waits on the DS' }).join('\n'),
    /own\.css\.ts is listed in EXCEPTIONS .* but is gone/
  );
});

test('objectKeys reads an object literal’s top-level keys, shorthands and spreads', () => {
  assert.deepEqual(objectKeys(" inlineSize, 'block-size': x(1, 2), ...rest, gap: { a: 1 } "), [
    'inlineSize',
    'block-size',
    '...rest',
    'gap',
  ]);
});
