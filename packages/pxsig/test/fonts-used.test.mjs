/**
 * fonts-used.test.mjs — the fonts a render's text was drawn in (lib/capture/fonts.mjs,
 * lib/fonts-used.mjs): a face is named only when the page's CSS names it or it is a web font,
 * else kept as a digest; a check whose render drew other faces than its baseline's is an
 * environment mismatch (`fonts.used`), its text not compared, and `--strict-env` fails it; a
 * baseline without fonts compares as unknown, silently; a non-Chromium render records none.
 *
 *   node --test packages/pxsig/test/fonts-used.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fontsFile, usedFonts, writeFonts } from '../src/lib/capture/fonts.mjs';
import { annotateRow } from '../src/lib/env.mjs';
import { compareFonts, envSentence, sayFontsUsed } from '../src/lib/fonts-used.mjs';
import { readHeader } from '../src/lib/psig.mjs';
import { envPlan } from '../src/lib/text/env-plan.mjs';
import { openProject, writeRunManifest } from '../src/lib/workspace.mjs';
import { fixture, rustBin, tempDir, testEnv, testHome } from './fixture.mjs';
import { needs, src } from './env-helpers.mjs';
import { renderOn, standIn, storybook } from './text-helpers.mjs';
import { FAMILY, fontFace } from './test-font.mjs';
/** @import { CheckRow } from '../src/types.js' */
/** @import { UsedFonts } from '../src/types/fonts.js' */

/** A face as Chromium's CSS.getPlatformFontsForNode reports it. */
const face = (
  /** @type {string} */ familyName,
  /** @type {number} */ glyphCount,
  isCustomFont = false
) => ({
  familyName,
  postScriptName: familyName.replace(/\W/g, ''),
  isCustomFont,
  glyphCount,
});

test('a face is named only when the page names it or it is a web font; any other is a digest', () => {
  const rec = usedFonts(
    [face('Inter', 10, true), face('Helvetica', 4), face('Courier', 2), face('Helvetica', 1)],
    ['courier', 'monospace'],
    3
  );
  assert.deepEqual(rec.used.slice(0, 2), [
    { family: 'Courier', glyphs: 2, web: false },
    { family: 'Inter', glyphs: 10, web: true },
  ]);
  // Helvetica is no family the page named: an OS fallback, kept by digest only, glyphs summed.
  assert.equal(rec.used.length, 3);
  assert.deepEqual(Object.keys(rec.used[2]).sort(), ['digest', 'glyphs', 'web']);
  assert.match(/** @type {string} */ (rec.used[2].digest), /^[0-9a-f]{8}$/);
  assert.equal(rec.used[2].glyphs, 5);
  assert.doesNotMatch(JSON.stringify(rec), /Helvetica/);
  assert.equal(rec.elements, 3);
});

test('comparing: other faces are a mismatch (fonts.used); same faces, or an unknown side, say nothing', () => {
  /** @type {UsedFonts} */
  const a = { v: 1, used: [{ family: 'Inter', glyphs: 9, web: true }], elements: 1 };
  /** @type {UsedFonts} */
  const b = { v: 1, used: [{ digest: '0a1b2c3d', glyphs: 9, web: false }], elements: 1 };
  assert.equal(compareFonts(a, { ...a, used: [{ ...a.used[0], glyphs: 40 }] }), null, 'glyphs');
  assert.equal(compareFonts(null, b), null, 'a baseline without fonts');
  assert.equal(compareFonts(a, undefined), null, 'a render without fonts');
  const d = compareFonts(a, b);
  assert.deepEqual(d, {
    added: [{ digest: '0a1b2c3d', web: false }],
    removed: [{ family: 'Inter', web: true }],
  });
  assert.equal(sayFontsUsed(d), 'fonts.used: +a system fallback font, −Inter');
  /** @type {CheckRow} */
  const row = {
    id: 'a--b',
    baselineEnv: 'e1',
    textDiff: /** @type {any} */ ({ v: 1, state: 'compared', kind: 'copy' }),
  };
  const env = /** @type {any} */ ({ id: 'e1', v: 1 });
  const opts = { current: { chromium: env }, envs: { e1: env } };
  const same = annotateRow(row, { ...opts, fonts: { render: a, baseline: a } });
  assert.equal(same.envMatch, 'same');
  assert.equal(same.textDiff?.state, 'compared');
  const swapped = annotateRow(row, { ...opts, fonts: { render: b, baseline: a } });
  assert.equal(swapped.envMatch, 'mismatch');
  assert.deepEqual(swapped.envDiff, ['fonts.used']);
  assert.deepEqual(swapped.envFontsUsed, d);
  assert.deepEqual(swapped.textDiff, { v: 1, state: 'env-differs' }, 'never a copy change');
  assert.equal(
    envSentence(swapped),
    'rendered in another environment than its baseline: fonts.used: +a system fallback font, −Inter'
  );
  const old = annotateRow(row, { ...opts, fonts: { render: b, baseline: null } });
  assert.equal(old.envMatch, 'same', 'an old baseline compares as unknown, silently');
  assert.equal(old.envFontsUsed, undefined);
  const ignored = annotateRow(row, {
    ...opts,
    ignore: ['fonts.used'],
    fonts: { render: b, baseline: a },
  });
  assert.equal(ignored.envMatch, 'same', 'env.ignore leaves it out');
});

test('new text in a system fallback: the copy change wins, narrowly', () => {
  /** @type {UsedFonts} */
  const base = { v: 1, used: [{ family: 'Inter', glyphs: 9, web: true }], elements: 1 };
  const fallback = { digest: '0a1b2c3d', glyphs: 1, web: false };
  const env = /** @type {any} */ ({ id: 'e1', v: 1 });
  const opts = { current: { chromium: env }, envs: { e1: env } };
  const counts = { runs: 1, copy: 0, moved: 0, rewrapped: 0, restyled: 0, added: 0, removed: 0 };
  /** @param {Partial<typeof counts>} c @returns {CheckRow} */
  const row = (c) => ({
    id: 'a--b',
    baselineEnv: 'e1',
    textDiff: /** @type {any} */ ({
      v: 1,
      state: 'compared',
      kind: c.copy || c.added ? 'copy' : null,
      kinds: c.copy ? ['copy'] : [],
      counts: { ...counts, ...c },
      changes: [],
      changeCount: 0,
    }),
  });
  const render = (/** @type {object[]} */ ...extra) =>
    /** @type {UsedFonts} */ ({ ...base, used: [...base.used, ...extra] });
  // A copy change and a fallback added: still a copy change, the fallback a note.
  const copy = annotateRow(row({ copy: 1 }), {
    ...opts,
    fonts: { render: render(fallback), baseline: base },
  });
  assert.equal(copy.envMatch, 'same');
  assert.equal(copy.envDiff, undefined);
  assert.equal(copy.textDiff?.state, 'compared');
  assert.deepEqual(copy.envFontsUsed, {
    added: [{ digest: '0a1b2c3d', web: false }],
    removed: [],
    newText: true,
  });
  // Added text (a new run) counts as new text too.
  assert.equal(
    annotateRow(row({ added: 1 }), { ...opts, fonts: { render: render(fallback), baseline: base } })
      .envMatch,
    'same'
  );
  // The same fallback with no copy change: a swap.
  const none = annotateRow(row({}), {
    ...opts,
    fonts: { render: render(fallback), baseline: base },
  });
  assert.equal(none.envMatch, 'mismatch');
  assert.deepEqual(none.envDiff, ['fonts.used']);
  assert.equal(none.envFontsUsed?.newText, undefined);
  // A copy change and a face removed: a swap.
  const removed = annotateRow(row({ copy: 1 }), {
    ...opts,
    fonts: { render: { ...base, used: [fallback] }, baseline: base },
  });
  assert.equal(removed.envMatch, 'mismatch');
  assert.equal(removed.textDiff?.state, 'env-differs');
  // A copy change and a named face added: a swap.
  const named = annotateRow(row({ copy: 1 }), {
    ...opts,
    fonts: { render: render({ family: 'Arial', glyphs: 1, web: false }), baseline: base },
  });
  assert.equal(named.envMatch, 'mismatch');
  assert.deepEqual(named.envFontsUsed?.added, [{ family: 'Arial', web: false }]);
});

test('Firefox and WebKit record no fonts, and an older record is removed', async (t) => {
  const png = join(tempDir('fonts-engine', t), 'a--b.png');
  writeFileSync(fontsFile(png), '{"v":1,"used":[],"elements":0}');
  const page = /** @type {any} */ ({
    evaluate: async () => {
      throw new Error('not asked');
    },
  });
  assert.equal(await writeFonts(page, png, { root: null, browser: 'firefox' }), null);
  assert.equal(await writeFonts(page, png, { root: null, browser: 'webkit' }), null);
  assert.equal(existsSync(fontsFile(png)), false);
});

test(
  'a render records its faces: the test font by name, an OS fallback by digest only',
  { skip: needs },
  async (t) => {
    const pw = await import('playwright');
    const sb = await standIn(
      {
        'fonts--own': '<p>Card 12</p>',
        'fonts--fallback': '<p style="font-family:sans-serif">Card 12</p>',
      },
      '',
      { font: true }
    );
    const browser = await pw.chromium.launch();
    t.after(async () => {
      await browser.close();
      sb.close();
    });
    const dir = tempDir('fonts-render', t);
    const results = await renderOn(
      browser,
      sb.url,
      [{ id: 'fonts--own' }, { id: 'fonts--fallback' }],
      dir
    );
    for (const r of results) assert.equal(r.error, undefined, r.error);
    const own = JSON.parse(readFileSync(join(dir, 'fonts--own.fonts.json'), 'utf8'));
    assert.deepEqual(own, {
      v: 1,
      used: [{ family: FAMILY, glyphs: own.used[0].glyphs, web: true }],
      elements: 1,
    });
    assert.ok(own.used[0].glyphs > 0);
    const raw = readFileSync(join(dir, 'fonts--fallback.fonts.json'), 'utf8');
    const fb = JSON.parse(raw);
    assert.ok(fb.used.length >= 1);
    for (const f of fb.used) {
      assert.equal(f.family, undefined, `an OS fallback is never named: ${raw}`);
      assert.match(f.digest, /^[0-9a-f]{8}$/);
    }
    assert.deepEqual(results[0].fonts, own, 'the render result carries the record');
  }
);

test(
  'a check whose render drew another face than its baseline: an environment mismatch, text not compared, --strict-env fails it',
  { skip: needs },
  async () => {
    const f = fixture();
    const id = f.ids.ok;
    /** @type {{ body: string, face?: string }} */
    const html = { body: '<p style="margin:0">Card 12 · of 9</p>' };
    const sb = await storybook(
      {
        id,
        title: 'Components/Alpha',
        name: 'Default',
        importPath: 'src/components/Alpha/Alpha.stories.tsx',
      },
      html
    );
    const cfgPath = join(f.repo, 'pxsig.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, storybook: { url: sb.url } }, null, 2));
    /** @param {string[]} [args] @returns {Promise<{ status: number | null, out: string }>} */
    const check = (args = []) =>
      new Promise((ok) => {
        const p = spawn(
          process.execPath,
          [join(src, 'check.mjs'), '--only', id, '--retries', '0', '--no-a11y', ...args],
          { cwd: f.repo, env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } }
        );
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (out += d));
        p.on('close', (status) => ok({ status, out }));
      });
    const report = () => JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8'));
    const row = () =>
      /** @type {CheckRow} */ (report().rows.find((/** @type {CheckRow} */ x) => x.id === id));
    const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
    /** Re-take the baseline from the last render, with its environment (and fonts, when recorded). */
    const baseline = () => {
      const plan = join(f.repo, '.env-plan.json');
      writeFileSync(
        plan,
        JSON.stringify(
          envPlan([{ id }], { chromium: report().envs[/** @type {string} */ (row().env)] })
        )
      );
      const b = spawnSync(
        rustBin,
        [
          'baseline',
          '--manifest',
          writeRunManifest(P).path,
          '--png-dir',
          P.store.latest,
          '--root',
          P.workspaceRoot,
          '--only',
          id,
          '--env',
          `@${plan}`,
          '--json',
        ],
        { encoding: 'utf8' }
      );
      assert.equal(b.status, 0, b.stderr);
    };
    const sig = join(
      f.repo,
      JSON.parse(readFileSync(join(f.px, 'manifest.json'), 'utf8')).stories.find(
        (/** @type {{ id: string }} */ e) => e.id === id
      ).sig
    );
    try {
      let r = await check();
      baseline();
      const head = readHeader(sig);
      assert.deepEqual(
        head?.fonts?.used.map((x) => [x.family, x.web]),
        [[FAMILY, true]],
        'the header keeps the fonts'
      );
      r = await check();
      assert.equal(r.status, 0, r.out);
      assert.equal(row().envMatch, 'same', r.out);
      assert.equal(row().textDiff?.state, 'compared');
      // Another face under the same CSS family: the text is drawn in other glyphs.
      html.face = fontFace({ name: 'pxsig-other', seed: 1 });
      r = await check();
      const swapped = row();
      assert.equal(swapped.envMatch, 'mismatch', r.out);
      assert.deepEqual(swapped.envDiff, ['fonts.used']);
      assert.deepEqual(swapped.envFontsUsed, {
        added: [{ family: 'pxsig-other', web: true }],
        removed: [{ family: FAMILY, web: true }],
      });
      assert.equal(swapped.textDiff?.state, 'env-differs', 'a font swap is never a copy change');
      assert.match(
        r.out,
        /\[check\] env: 1 of 1 entries rendered in a different environment than their baseline \(fonts\.used: \+pxsig-other, −pxsig-test\)/
      );
      // pxsig entry says it; MCP pxsig_entry gives the same as envFontsUsed and envLine.
      const entry = spawnSync(process.execPath, [join(src, 'cli.mjs'), 'entry', id, '--plain'], {
        cwd: f.repo,
        encoding: 'utf8',
        env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' },
      });
      assert.match(
        entry.stdout,
        /Environment:\*\* rendered in another environment than its baseline: fonts\.used: \+pxsig-other, −pxsig-test/,
        entry.stdout + entry.stderr
      );
      const strict = await check(['--strict-env']);
      assert.equal(strict.status, 2, strict.out);
      assert.match(
        strict.out,
        /1 renders drew their text in other fonts than their baselines; --strict-env fails the run \(exit 2\)/
      );
      // Back on the baseline's face, with new text in a character the test font lacks (→): the OS
      // draws it in a fallback. The copy change wins: no mismatch, a note, --strict-env passes it.
      html.face = undefined;
      html.body = '<p style="margin:0">Card 12 · of 9 →</p>';
      r = await check(['--strict-env']);
      assert.notEqual(r.status, 2, r.out);
      assert.equal(row().envMatch, 'same', r.out);
      assert.equal(row().envFontsUsed?.newText, true, JSON.stringify(row().envFontsUsed));
      assert.equal(row().textDiff?.state, 'compared');
      assert.match(
        r.out,
        /1 of 1 entries drew new text in a system fallback font \(\+ a system fallback font for new text\)/
      );
      assert.doesNotMatch(r.out, /fonts\.used/);
      // A baseline written before fonts were recorded: unknown, silently.
      rmSync(join(P.store.latest, `${id}.fonts.json`));
      baseline();
      assert.equal(readHeader(sig)?.fonts, undefined);
      r = await check();
      assert.notEqual(row().envMatch, 'mismatch', r.out);
      assert.equal(row().envFontsUsed, undefined);
      assert.doesNotMatch(r.out, /fonts\.used/);
    } finally {
      sb.close();
    }
  }
);
