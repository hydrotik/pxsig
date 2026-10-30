/**
 * docs.test.mjs — the pages that describe the code, against the code, so they cannot drift:
 * which browser renders (docs/platforms.md and `pxsig help platforms`, against lib/capture.mjs's
 * channel list), the programs pxsig starts (the same pages, against lib/spawn.mjs's list), and the
 * errors in docs/troubleshooting.md and `pxsig help troubleshooting` (every quoted text exists in
 * src/, and the help page is a short form of the doc).
 *
 *   node --test packages/pxsig/test/docs.test.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { helpSource } from '../src/help.mjs';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(pkg, '..', '..');
/** @param {...string} p */
const read = (...p) => readFileSync(join(...p), 'utf8').replace(/\r\n/g, '\n');
const { topics } = helpSource();
const platformsDoc = read(repo, 'docs', 'platforms.md');
const platformsHelp = topics.platforms;

/**
 * The text of one `## ` section of a Markdown page, up to the next one.
 * @param {string} md
 * @param {string} heading
 */
function section(md, heading) {
  const start = md.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `no section "${heading}"`);
  const end = md.indexOf('\n## ', start + 1);
  return md.slice(start, end < 0 ? undefined : end);
}

/**
 * The cells of each body row of the first table in `md`.
 * @param {string} md
 * @returns {string[][]}
 */
function tableRows(md) {
  return md
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .slice(2)
    .map((l) =>
      l
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => c.trim())
    );
}

/** The channels launchBrowser tries after Playwright's own Chromium, in order. */
function fallbackChannels() {
  const src = read(pkg, 'src', 'lib', 'capture', 'browser.mjs');
  const fn = src.slice(src.indexOf('export async function launchBrowser'));
  // launchBrowser has the list: `channel ? [channel] : [undefined, 'chrome', 'msedge']`.
  const list = /** @type {RegExpMatchArray} */ (fn.match(/: \[undefined, ([^\]]*)\]/))[1];
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** What each channel is called on the pages. A new channel needs its name here and on both pages. */
/** @type {Record<string, string>} */
const CHANNEL_NAMES = { chrome: 'Google Chrome', msedge: 'Microsoft Edge' };

test("the browser fallback: both pages list capture.mjs's channels, in its order", () => {
  const channels = fallbackChannels();
  assert.ok(channels.length >= 1, 'launchBrowser has a fallback list');
  for (const ch of channels) assert.ok(CHANNEL_NAMES[ch], `a name for channel ${ch}`);

  const rows = tableRows(section(platformsDoc, 'Which browser renders'));
  assert.deepEqual(
    rows.map((r) => r[2]),
    ['none', ...channels.map((c) => `\`${c}\``)],
    'docs/platforms.md "Which browser renders": the table, in launch order'
  );
  rows.slice(1).forEach((r, i) => assert.match(r[1], new RegExp(CHANNEL_NAMES[channels[i]])));

  const programs = section(platformsDoc, 'Programs pxsig starts');
  const browserRow = /** @type {string} */ (
    tableRows(programs)
      .map((r) => r[0])
      .find((c) => c.startsWith('Chromium'))
  );
  assert.ok(browserRow, 'docs/platforms.md "Programs pxsig starts": the browser row');
  /** @param {string} text */
  const order = (text) => channels.map((c) => text.indexOf(CHANNEL_NAMES[c].split(' ').pop() ?? c));
  /** @param {number[]} at */
  const ascending = (at) => at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1]));
  assert.ok(ascending(order(browserRow)), `the browser row names ${channels.join(', ')} in order`);

  const help = /** @type {string} */ (
    platformsHelp.split('\n\n').find((p) => p.startsWith('**Which browser renders:**'))
  );
  assert.ok(help, '`pxsig help platforms`: the "Which browser renders" paragraph');
  assert.ok(
    ascending(channels.map((c) => help.indexOf(`\`${c}\``))),
    `\`pxsig help platforms\` names the channels ${channels.join(', ')} in order`
  );
});

/** lib/spawn.mjs's list: OS → the programs it may start there (besides node and the engine). */
function spawnList() {
  const src = read(pkg, 'src', 'lib', 'spawn.mjs');
  const block = /** @type {RegExpMatchArray} */ (src.match(/const BY_OS = \{([\s\S]*?)\};/))[1];
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const m of block.matchAll(/(\w+): \[([^\]]*)\]/g))
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  return out;
}

const OS_NAMES = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };

test("the programs pxsig starts: both pages name spawn.mjs's list, and the table names nothing else", () => {
  const byOs = spawnList();
  assert.deepEqual(Object.keys(byOs).sort(), Object.keys(OS_NAMES).sort());
  const rows = tableRows(section(platformsDoc, 'Programs pxsig starts'));
  /** @param {string} cell */
  const named = (cell) =>
    [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1].split(' ')[0]).filter((n) => /^[a-z]/.test(n));
  for (const [os, programs] of Object.entries(byOs))
    for (const p of programs) {
      const row = rows.find((r) => named(r[0]).includes(p));
      assert.ok(row, `docs/platforms.md: a row for \`${p}\``);
      const where = row[1];
      assert.ok(
        where.startsWith('all') ||
          where.includes(OS_NAMES[/** @type {keyof typeof OS_NAMES} */ (os)]),
        `docs/platforms.md: \`${p}\` on ${os} (the row says "${where}")`
      );
      assert.ok(platformsHelp.includes(`\`${p}\``), `\`pxsig help platforms\` names \`${p}\``);
    }
  const allowed = new Set(['node', 'pxsig', ...Object.values(byOs).flat()]);
  const extra = rows.flatMap((r) => named(r[0])).filter((n) => !allowed.has(n));
  assert.deepEqual(extra, [], 'docs/platforms.md names a program spawn.mjs does not list');
});

/** Every source file under src/, as one text; an escaped backtick reads as the one it prints. */
function sourceText() {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) out.push(readFileSync(p, 'utf8').replace(/\\`/g, '`'));
    }
  };
  walk(join(pkg, 'src'));
  return out.join('\n');
}

/**
 * The quoted error texts (`> ` lines) of a page.
 * @param {string} md
 */
const quotes = (md) => [...md.matchAll(/^> (.+)$/gm)].map((m) => m[1]);

test('troubleshooting: every quoted error text exists in src/, and both pages list the same errors', () => {
  const doc = read(repo, 'docs', 'troubleshooting.md');
  const help = topics.troubleshooting;
  assert.ok(help, '`pxsig help troubleshooting` exists');
  const src = sourceText();
  for (const [where, md] of [
    ['docs/troubleshooting.md', doc],
    ['`pxsig help troubleshooting`', help],
  ])
    for (const q of quotes(md)) assert.ok(src.includes(q), `${where}: "${q}" is not in src/`);
  // The help page is the short form: it may leave a quote out, never add one.
  const inDoc = new Set(quotes(doc));
  assert.deepEqual(
    quotes(help).filter((q) => !inDoc.has(q)),
    [],
    'the help page quotes only what docs/troubleshooting.md does'
  );

  // One entry per error, the same entries on both pages, each with what pxsig prints.
  const docEntries = [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const helpParts = help.split(/^\*\*(.+)\*\*$/m).slice(1);
  const helpEntries = helpParts.filter((_, i) => i % 2 === 0);
  assert.deepEqual(helpEntries, docEntries, 'the same entries, in the same order');
  for (const h of docEntries)
    assert.ok(quotes(section(doc, h)).length, `docs/troubleshooting.md "${h}" quotes an error`);
  helpParts.forEach((body, i) => {
    if (i % 2)
      assert.ok(
        quotes(body).length,
        `\`pxsig help troubleshooting\` "${helpParts[i - 1]}" quotes an error`
      );
  });
});

test('docs/cli.md lists every help topic', () => {
  const md = read(repo, 'docs', 'cli.md');
  const line = /** @type {RegExpMatchArray} */ (md.match(/- \*\*a topic\*\*: ([^;]*);/))[1];
  const listed = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, Object.keys(topics).sort());
});
