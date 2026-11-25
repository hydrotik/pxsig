/**
 * No dashboard style changes a design-system element (ui-tools/ds-reach.mjs): the committed
 * dashboard has only the findings listed in ui-tools/ds-reach-pending.json, and each rule finds
 * what it is for: a contract component's class or inline style that sets more than layout glue
 * (R), a global selector on a design-system hook (G), a focus rule that is not a shared focus line
 * (F). Layout glue, the dashboard's own attributes and the shared focus lines pass.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readContract } from '../ui-tools/contract.mjs';
import { dsReachFindings, dsReachProblems } from '../ui-tools/ds-reach.mjs';

const dashboard = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contract = new Set(Object.keys(readContract()));

/** The finding ids of a source folder holding `files`, of one rule (`R`, `G` or `F`). */
function idsOf(/** @type {Record<string, string>} */ files, /** @type {string} */ rule) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pxsig-ds-reach-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), text);
    }
    return dsReachFindings(dir, contract)
      .map((f) => f.id)
      .filter((id) => id.startsWith(`${rule}:`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sheet = [
  "import { globalStyle, style } from '@vanilla-extract/css';",
  "export const glue = style({ inlineSize: '100%', flex: 1 });",
  "export const look = style({ fontFamily: 'mono', // a comment's apostrophe: don't\n  padding: 0 });",
  "export const own = style({ display: 'flex' });",
  "export const card = style({ selectors: { '&:focus-visible': focusOutline } });",
  "export const halo = style({ selectors: { '&:focus-visible': { boxShadow: '0 0 0 3px red' } } });",
].join('\n');

test('the committed dashboard has only the listed findings', () => {
  const pending = JSON.parse(
    readFileSync(path.join(dashboard, 'ui-tools/ds-reach-pending.json'), 'utf8')
  );
  assert.deepEqual(dsReachProblems(path.join(dashboard, 'src'), contract, pending), []);
  for (const [id, why] of Object.entries(pending))
    assert.ok(why.length > 20, `${id} says what it waits on`);
});

test('R: glue passes; a look, an unreadable class or a non-glue inline style is found', () => {
  const ids = idsOf(
    {
      'styles/a.css.ts': sheet,
      'views/V.tsx': [
        "import { Card, CardTitle, Dialog, type DialogTitle } from '@ui';",
        "import * as s from '../styles/a.css';",
        "interface P { Title: 'h2' | typeof DialogTitle }",
        'export const V = ({ Title }: P) => (',
        '  <Card className={busy ? s.glue : undefined} style={{ blockSize: 2 }}>',
        '    <CardTitle className={`${s.look} ${s.glue}`}>x</CardTitle>',
        '    <Dialog className={pick(s.glue)} />',
        '    <Title className={s.look} style={{ margin: 0 }} />',
        '    <div className={s.look} />',
        '  </Card>',
        ');',
      ].join('\n'),
    },
    'R'
  );
  assert.deepEqual(ids.sort(), [
    'R:views/V.tsx:CardTitle:look',
    'R:views/V.tsx:Dialog:className',
    'R:views/V.tsx:Title:look',
    'R:views/V.tsx:Title:style',
  ]);
});

test("R: a class in a prop's JSX is not the component's own", () => {
  const ids = idsOf(
    {
      'styles/a.css.ts': sheet,
      'views/T.tsx': [
        "import { DataTable } from '@ui';",
        "import * as s from '../styles/a.css';",
        'export const T = () => <DataTable cell={() => <span className={s.look} />} />;',
      ].join('\n'),
    },
    'R'
  );
  assert.deepEqual(ids, []);
});

test("G: a design-system hook is found; the dashboard's own attributes and classes pass", () => {
  const ids = idsOf(
    {
      'styles/a.css.ts': [
        sheet,
        "globalStyle('[data-count-badge][data-tone=\"attention\"]', { color: 'red' });",
        "globalStyle('[role=\"menuitem\"]', { color: 'red' });",
        "globalStyle('.ds-button', { color: 'red' });",
        'globalStyle(`${own}[data-tone="success"]`, { color: \'red\' });',
        "globalStyle('[data-status=\"new\"] [data-top-bar]', { color: 'red' });",
        "globalStyle(`${glue} > *`, { alignItems: 'center' });",
      ].join('\n'),
      'views/V.tsx': [
        "import { Toolbar } from '@ui';",
        "import * as s from '../styles/a.css';",
        'export const V = () => <Toolbar className={s.glue} />;',
      ].join('\n'),
    },
    'G'
  );
  assert.deepEqual(ids.sort(), [
    'G:styles/a.css.ts:${glue} > *',
    'G:styles/a.css.ts:.ds-button',
    'G:styles/a.css.ts:[data-count-badge][data-tone="attention"]',
    'G:styles/a.css.ts:[role="menuitem"]',
  ]);
});

test('F: a focus rule other than the shared focus lines is found', () => {
  assert.deepEqual(idsOf({ 'styles/a.css.ts': sheet }, 'F'), ['F:styles/a.css.ts:&:focus-visible']);
});

test('a finding not listed fails, and so does a listed one that is gone', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pxsig-ds-reach-'));
  try {
    mkdirSync(path.join(dir, 'styles'));
    writeFileSync(path.join(dir, 'styles/a.css.ts'), sheet);
    const problems = dsReachProblems(dir, contract, { 'G:styles/a.css.ts:.gone': 'waits on x' });
    assert.equal(problems.length, 2);
    assert.match(problems[0], /the focus rule &:focus-visible/);
    assert.match(problems[1], /\.gone is listed .* no longer found: remove it/);
    assert.deepEqual(
      dsReachProblems(dir, contract, { 'F:styles/a.css.ts:&:focus-visible': 'waits on x' }),
      []
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
