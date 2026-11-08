/**
 * text-approve.test.mjs — an approval through the server (src/serve/review.mjs) stores the approved
 * render's text record as the baseline's `boxes` section when text capture is on, and none when it
 * is off, whatever an earlier render left beside the PNG; `pxsig doctor` counts the baselines that
 * have one. On the shared fixture, in process, in a temp folder.
 *
 *   node --test packages/pxsig/test/text-approve.test.mjs
 *
 * Needs the Rust binary (the engine writes the baseline); skipped without it.
 */
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readHeader } from '../src/lib/psig.mjs';
import { textFindings } from '../src/lib/text/doctor.mjs';
import { findWorkspace } from '../src/lib/workspace.mjs';
import { createPxsigServer } from '../src/serve/create.mjs';
import { review } from '../src/serve/review.mjs';
import { fixture, hasRust } from './fixture.mjs';
import { skipUnless } from './strict.mjs';

const RECORD = {
  v: 1,
  frame: { w: 128, h: 128 },
  styles: [],
  runs: [{ path: '0/#0', s: 'Card', st: 0, boxes: [[4, 4, 30, 18]] }],
  elements: [],
  skipped: {},
  truncated: false,
};

/**
 * Approve the a11y entry of a fixture whose config has `text` (absent when undefined), with a text
 * record beside its latest render; the baseline's section names and the doctor's text line.
 * @param {unknown} text
 */
async function approveWith(text) {
  const f = fixture();
  rmSync(join(f.repo, '.git'), { recursive: true });
  const cfgFile = join(f.repo, 'pxsig.config.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  if (text !== undefined) cfg.text = text;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  const id = f.ids.a11y;
  writeFileSync(join(f.px, 'renders', 'latest', `${id}.boxes.json`), JSON.stringify(RECORD));
  const app = createPxsigServer({
    ws: findWorkspace({ cwd: f.repo }),
    flags: {},
    port: 0,
    open: false,
  });
  try {
    await app.start();
    const { srv } = app;
    const S = [...srv.states.values()][0];
    await S.integrityDone;
    const entry = await review(srv, S, 'approve', id, { via: 'cli' });
    assert.equal(entry?.state, 'approved');
    const e = S.manifest.stories.find((s) => s.id === id);
    const h = readHeader(join(f.repo, /** @type {{ sig: string }} */ (e).sig));
    const doctor = textFindings(S.P).find((x) => x.code === 'text-capture')?.text;
    return {
      sections: (h?.sections ?? []).map((s) => s.name),
      runs: h?.sections?.[2]?.runs,
      doctor,
    };
  } finally {
    await app.stop();
  }
}

const skip = skipUnless(hasRust, 'Rust binary not built');

test("text on: the approved render's text record becomes the boxes section", { skip }, async () => {
  const r = await approveWith(true);
  assert.deepEqual(r.sections, ['sig', 'image', 'boxes']);
  assert.equal(r.runs, 1);
  assert.match(String(r.doctor), /^on · 1 of \d+ baselines have a text record$/);
});

test('text off: no boxes section, whatever is beside the render', { skip }, async () => {
  const r = await approveWith(false);
  assert.deepEqual(r.sections, ['sig', 'image']);
  assert.match(
    String(r.doctor),
    /^off \(text: false in pxsig\.config\.json\) · 0 of \d+ baselines/
  );
});
