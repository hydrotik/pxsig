/**
 * rejected-tools.test.mjs — reading open rejections (tools/rejected.mjs): pxsig_rejected (file
 * references by default, crops inline on request, the image budget, `kind`, `closed`, the re-check
 * command it repeats), the rejection fields on pxsig_entry, pxsig_list, pxsig_status and
 * pxsig_check, and `pxsig rejected` in JSON, Markdown and `--prompt`. No answer carries an
 * absolute path, the home folder or the temp folder.
 *
 *   node --test packages/pxsig/test/rejected-tools.test.mjs
 *
 * Needs the Rust binary (the packet's crops come from the engine's `diff`).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeRejection, openRejection, readRejections } from '../src/lib/rejections.mjs';
import { engineDiff, packetFor } from '../src/lib/rejections/packet.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { tools } from '../src/tools/index.mjs';
import {
  checkedRejections,
  MAX_IMAGES,
  nextLine,
  rejectionImages,
} from '../src/tools/rejected.mjs';
import { BROKEN, CHECKER, fixture, hasRust, rustBin, testEnv, testHome } from './fixture.mjs';
import { serve } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

const rust = skipUnless(hasRust, 'Rust binary not built');
const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pxsig.mjs');
const NOTE = 'the label moved right';
const AGENT_NOTE = 'the person says: keep the old spacing';

/** @param {ReturnType<typeof fixture>} f */
const projectOf = (f) =>
  openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });

/**
 * A tool, run in-process on the fixture's workspace.
 * @param {string} name
 */
const tool = (name) =>
  /** @type {{ run: (a?: Record<string, unknown>) => Promise<any> }} */ (
    tools.find((x) => x.name === name)
  );

/**
 * Run the tools on `f` (PXSIG_WORKSPACE, put back after the test).
 * @param {ReturnType<typeof fixture>} f
 * @param {{ after: (fn: () => void) => void }} t
 */
function useWorkspace(f, t) {
  const was = process.env.PXSIG_WORKSPACE;
  process.env.PXSIG_WORKSPACE = f.repo;
  t.after(() => {
    if (was === undefined) delete process.env.PXSIG_WORKSPACE;
    else process.env.PXSIG_WORKSPACE = was;
  });
}

/**
 * @param {ReturnType<typeof fixture>} f
 * @param {string} text
 */
const noPaths = (f, text) => {
  for (const p of [f.repo, homedir(), tmpdir(), f.repo.replaceAll('\\', '/')])
    assert.ok(!text.includes(p), `no absolute path: ${p}`);
};

/**
 * A rejection by a person, an assistant's note on it, and its packet.
 * @param {ReturnType<typeof fixture>} f
 */
async function rejected(f) {
  const P = projectOf(f);
  const id = f.ids.changed;
  writeFileSync(f.latest(id), BROKEN);
  openRejection(P, 'visual', id, { via: 'dashboard', note: NOTE, ignored: true });
  openRejection(P, 'visual', id, { via: 'mcp', note: AGENT_NOTE, ignored: true });
  const { error } = await packetFor(P, 'visual', id, { diff: engineDiff(rustBin), ignored: true });
  assert.equal(error, null);
  return { P, id };
}

test(
  'pxsig_rejected: reasons, regions as file references, the prompt and the re-check command',
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    useWorkspace(f, t);
    const { id } = await rejected(f);
    const r = await tool('pxsig_rejected').run();
    assert.equal(r.content.length, 1, 'file references only by default');
    noPaths(f, r.content[0].text);
    const a = JSON.parse(r.content[0].text);
    assert.equal(a.open, 1);
    assert.equal(a.store, '.pxsig');
    assert.equal(a.next, nextLine([id]));
    assert.match(a.next, new RegExp(`^After the fix: pxsig check ${id} .*Never approve`));
    assert.equal(a.imagesHint, 'images: "crops" returns the crops inline');
    const [e] = a.entries;
    assert.deepEqual(
      [e.id, e.kind, e.state, e.note, e.via],
      [id, 'visual', 'changed', NOTE, 'dashboard']
    );
    assert.deepEqual(
      e.notes.map((/** @type {{ from: string }} */ n) => n.from),
      ["mcp, an assistant at the person's request", 'the dashboard'],
      "an assistant's note is labelled as one, and never leads"
    );
    assert.equal(e.packet, `reports/rejected/${id}/`);
    assert.equal(e.files.rejection, `reports/rejected/${id}/rejection.md`);
    assert.equal(e.regions.length, 1);
    assert.equal(e.regions[0].crops.diff, `reports/rejected/${id}/crops/1.diff.png`);
    assert.equal(e.next, `pxsig check ${id}`);
    assert.match(e.prompt, new RegExp(`^pxsig rejected ${id} \\(fixture\\): "${NOTE}"\\.`));
    assert.ok(e.prompt.includes(`.pxsig/reports/rejected/${id}/rejection.md`));

    const crops = await tool('pxsig_rejected').run({ images: 'crops' });
    const labels = crops.content
      .slice(1)
      .filter((/** @type {{ type: string }} */ c) => c.type === 'text');
    assert.deepEqual(
      labels.map((/** @type {{ text: string }} */ c) => c.text.split(' (')[0]),
      ['baseline', 'current', 'diff'].map((k) => `${id} region 1 of 1, 0,0 128×128: ${k}`)
    );
    assert.equal(
      crops.content.filter((/** @type {{ type: string }} */ c) => c.type === 'image').length,
      3
    );
    const full = await tool('pxsig_rejected').run({ images: 'full' });
    assert.equal(
      full.content.filter((/** @type {{ type: string }} */ c) => c.type === 'image').length,
      6
    );

    const a11y = JSON.parse((await tool('pxsig_rejected').run({ kind: 'a11y' })).content[0].text);
    assert.deepEqual([a11y.open, a11y.note], [0, 'No open rejections.']);
    await assert.rejects(tool('pxsig_rejected').run({ images: 'all' }), /images must be one of/);
    await assert.rejects(tool('pxsig_rejected').run({ ids: ['../x'] }), /bad ids/);
  }
);

test(
  'pxsig_entry, pxsig_list and pxsig_status carry the rejection; closed ones come from the log',
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    useWorkspace(f, t);
    const { P, id } = await rejected(f);
    const entry = await tool('pxsig_entry').run({ id });
    const json = JSON.parse(entry.content[0].text);
    assert.equal(json.rejection.note, NOTE);
    assert.equal(json.rejectedBefore, true);
    assert.equal(entry.content.length, 1 + 3 + 2, 'images unchanged without crops');
    const withCrops = await tool('pxsig_entry').run({ id, images: ['crops'] });
    assert.equal(
      withCrops.content.filter((/** @type {{ type: string }} */ c) => c.type === 'image').length,
      3
    );
    noPaths(
      f,
      JSON.stringify(
        withCrops.content.filter((/** @type {{ type: string }} */ c) => c.type === 'text')
      )
    );

    const list = await tool('pxsig_list').run({ state: 'changed' });
    const brief = list.entries.find((/** @type {{ id: string }} */ e) => e.id === id);
    assert.deepEqual([brief.rejectedBefore, brief.note], [true, NOTE]);
    const other = list.entries.find((/** @type {{ id: string }} */ e) => e.id !== id);
    assert.ok(!other || other.rejectedBefore === undefined);
    const status = await tool('pxsig_status').run();
    assert.equal(status.openRejections, 1);
    assert.equal(status.hint, 'pxsig_rejected lists them with the reasons and images');

    // pxsig_check's words, from the records before and after.
    const before = readRejections(P);
    assert.deepEqual(checkedRejections(P, before, [id, f.ids.ok]), [
      { id, kind: 'visual', rejection: 'open: still differs' },
    ]);
    closeRejection(P, 'visual', id, 'passed');
    assert.deepEqual(checkedRejections(P, before, [id]), [
      { id, kind: 'visual', rejection: 'closed: passes' },
    ]);
    assert.equal((await tool('pxsig_status').run()).hint, undefined);
    const closed = await tool('pxsig_rejected').run({ closed: true });
    assert.equal(closed.total, 1);
    assert.deepEqual(
      [
        closed.entries[0].id,
        closed.entries[0].as,
        closed.entries[0].note,
        closed.entries[0].notes.length,
      ],
      [id, 'passed', NOTE, 2]
    );
  }
);

test('the image budget: at most 18 inline, the rest as store-relative paths', (t) => {
  const f = fixture({ t, withSigs: false });
  const P = projectOf(f);
  const packet = `reports/rejected/${f.ids.changed}/`;
  mkdirSync(join(f.px, packet, 'crops'), { recursive: true });
  /** @type {any[]} */
  const regions = [];
  for (let n = 1; n <= 7; n++) {
    for (const k of ['baseline', 'current', 'diff'])
      writeFileSync(join(f.px, packet, 'crops', `${n}.${k}.png`), CHECKER);
    regions.push({
      n,
      x: 0,
      y: 0,
      w: 8,
      h: 8,
      px: 1,
      crops: Object.fromEntries(
        ['baseline', 'current', 'diff'].map((k) => [k, `${packet}crops/${n}.${k}.png`])
      ),
    });
  }
  const C = /** @type {any} */ ({ P, root: f.repo });
  const e = /** @type {any} */ ({ id: f.ids.changed, packet, regions, files: {} });
  const out = rejectionImages(C, [e], 'crops');
  assert.equal(out.filter((c) => c.type === 'image').length, MAX_IMAGES);
  const rest = out.filter((c) => c.type === 'text' && c.text.includes('not inline'));
  assert.equal(rest.length, 21 - MAX_IMAGES);
  assert.ok(rest.every((c) => c.type === 'text' && c.text.includes(`(${packet}crops/`)));
});

test(
  'pxsig rejected: JSON, Markdown with the reason fenced, and --prompt',
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    const { id } = await rejected(f);
    /** @param {string[]} args */
    const pxsig = (args) =>
      spawnSync(process.execPath, [cli, 'rejected', ...args], {
        cwd: f.repo,
        encoding: 'utf8',
        env: {
          ...testEnv(testHome),
          PXSIG_NO_DELEGATE: '1',
          PXSIG_URL: 'http://127.0.0.1:1',
          PXSIG_BIN: rustBin,
          PXSIG_WORKSPACE: '',
        },
      });
    const json = pxsig(['--json']);
    assert.equal(json.status, 0, json.stderr);
    const data = JSON.parse(json.stdout);
    assert.equal(data.entries[0].files.rejection, `./.pxsig/reports/rejected/${id}/rejection.md`);
    const md = pxsig(['--markdown']);
    assert.equal(md.status, 0, md.stderr);
    assert.ok(md.stdout.includes(`Rejected: ${id}`));
    assert.ok(md.stdout.includes(`\`\`\`text\n${NOTE}\n\`\`\``), 'the reason in a fence');
    assert.ok(md.stdout.includes(`pxsig check ${id}`));
    assert.ok(md.stdout.includes("Never approve: approving is the person's."));
    const prompt = pxsig(['--prompt']);
    assert.equal(prompt.status, 0, prompt.stderr);
    assert.match(prompt.stdout, new RegExp(`^pxsig rejected ${id} \\(fixture\\): "${NOTE}"\\.`));
    assert.equal(prompt.stdout.trim().split('\n').length, 1, 'one paragraph');
    assert.equal(pxsig(['--prompt', '--kind', 'a11y']).stdout, '', 'nothing when there is none');
    for (const out of [json.stdout, md.stdout, prompt.stdout]) noPaths(f, out);
    assert.equal(pxsig(['--kind', 'x']).status, 2);
  }
);

test(
  "pxsig_review sends an assistant's note with reject; refuses one with unreview",
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    const id = f.ids.changed;
    const S = await serve(f);
    const was = { url: process.env.PXSIG_URL, ws: process.env.PXSIG_WORKSPACE };
    process.env.PXSIG_URL = S.base;
    process.env.PXSIG_WORKSPACE = f.repo;
    try {
      const review = tool('pxsig_review');
      await assert.rejects(
        review.run({ action: 'unreview', ids: [id], confirm: true, note: 'x' }),
        /a note goes with reject or a11y-reject/
      );
      const r = await review.run({
        action: 'reject',
        ids: [id],
        confirm: true,
        note: `  ${'a'.repeat(300)}\n`,
      });
      assert.equal(r.done[0].id, id);
      const open = readRejections({ store: { reports: join(f.px, 'reports') } }).visual[id];
      assert.deepEqual([open.notes[0].via, open.notes[0].note], ['mcp', 'a'.repeat(280)]);
      // The packet is written after the answer: wait for it before the server stops.
      for (let i = 0; i < 100; i++) {
        const now = readRejections({ store: { reports: join(f.px, 'reports') } }).visual[id];
        if (now?.packet || now?.packetError) break;
        await new Promise((ok) => setTimeout(ok, 50));
      }
    } finally {
      if (was.url === undefined) delete process.env.PXSIG_URL;
      else process.env.PXSIG_URL = was.url;
      if (was.ws === undefined) delete process.env.PXSIG_WORKSPACE;
      else process.env.PXSIG_WORKSPACE = was.ws;
      await S.stop();
    }
  }
);
