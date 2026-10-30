/**
 * help-index.test.mjs — `pxsig help` alone and `pxsig --help` against src/help/commands.json: every
 * command, subcommand and topic is listed, no internal file is named, the formats agree; and the one
 * list of commands that need a person (`needsAPerson`) against each entry's effects and every page
 * that lists them.
 *
 *   node --test packages/pxsig/test/help-index.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { helpIndex, helpSource, lookup } from '../src/help.mjs';
import { testEnv, testHome } from './fixture.mjs';

/** @import { HelpCommandEntry } from '../src/types/t6.js' */

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(pkg, '..', '..');
const { global, commands, needsAPerson, topics } = helpSource();
const cli = join(pkg, 'bin', 'pxsig.mjs');
/**
 * @param {string[]} args
 * @param {string} [format]
 */
const pxsig = (args, format = 'plain') =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...testEnv(testHome), PXSIG_FORMAT: format, PXSIG_NO_DELEGATE: '1' },
  });

/** Every command and subcommand, by the name the index uses (`approve apply`). */
const names = () =>
  Object.entries(commands).flatMap(([c, e]) => [
    c,
    ...Object.keys(e.subcommands ?? {}).map((s) => `${c} ${s}`),
  ]);

test('pxsig --help lists every command, subcommand and topic, with its summary and usage', () => {
  const r = pxsig(['--help']);
  assert.equal(r.status, 0, r.stderr);
  const rows = new Set(r.stdout.split('\n'));
  for (const n of names()) {
    const [c, s] = n.split(' ');
    const e = /** @type {HelpCommandEntry} */ (s ? commands[c].subcommands?.[s] : commands[c]);
    assert.ok(rows.has(`| ${n} | ${e.summary.replace(/\|/g, '\\|')} |`), `${n}: its row`);
    for (const u of e.usage) assert.ok(rows.has(`- ${u}`), `${n}: ${u}`);
  }
  assert.ok(r.stdout.includes(`Topics: ${Object.keys(topics).join(', ')}.`), 'Topics line');
  for (const n of needsAPerson) assert.ok(rows.has(`- ${n}`), `needs a person: ${n}`);
  assert.match(r.stdout, /pxsig help <name>/);
  assert.match(r.stdout, /`pxsig version`/);
});

test('pxsig --help names no internal file', () => {
  for (const format of ['plain', 'pretty', 'json']) {
    const out = pxsig(['--help'], format).stdout;
    assert.doesNotMatch(out, /\bsrc\/|\blib\/|\.mjs\b/, format);
  }
});

test('pxsig help and pxsig --help are the same, in every format', () => {
  for (const format of ['plain', 'pretty', 'json'])
    assert.equal(pxsig(['help'], format).stdout, pxsig(['--help'], format).stdout, format);
  const data = JSON.parse(pxsig(['--help'], 'json').stdout);
  assert.deepEqual(data, JSON.parse(JSON.stringify(helpIndex().data)));
  assert.deepEqual(
    data.commands.map((/** @type {{ name: string }} */ c) => c.name),
    names()
  );
});

test('pxsig help topics lists every topic with its title, like any topic page', () => {
  const r = pxsig(['help', 'topics']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^# Topics/);
  for (const [t, md] of Object.entries(topics))
    assert.ok(r.stdout.includes(`- \`${t}\`: ${/^# (.+)$/m.exec(md)?.[1]}`), t);
  assert.equal(JSON.parse(pxsig(['help', 'topics'], 'json').stdout).kind, 'topic');
  assert.equal(lookup(['topics'])?.name, 'topics');
});

test('needsAPerson agrees with every entry whose effects say needs-a-person', () => {
  /** @type {Map<string, HelpCommandEntry>} */
  const marked = new Map();
  for (const [c, e] of Object.entries(commands)) {
    if (e.effects?.some((x) => x.startsWith('needs-a-person'))) marked.set(c, e);
    for (const [s, se] of Object.entries(e.subcommands ?? {}))
      if (se.effects?.some((x) => x.startsWith('needs-a-person'))) marked.set(`${c} ${s}`, se);
  }
  /** @param {string} n */
  const owner = (n) => {
    const [c, s] = n.split(' ');
    return commands[c]?.subcommands?.[s] ? `${c} ${s}` : c;
  };
  for (const n of needsAPerson) {
    const o = owner(n);
    const e = marked.get(o);
    assert.ok(e, `${n}: ${o} has no needs-a-person effect`);
    const parent = commands[o.split(' ')[0]];
    const known = new Set(
      [...global.flags, ...(parent.flags ?? []), ...(e.flags ?? [])].map((f) => f.name)
    );
    for (const [, f] of n.matchAll(/--([a-z-]+)/g)) assert.ok(known.has(f), `${n}: --${f}`);
    assert.ok(e.exits?.['3'], `${n}: ${o} lists exit 3`);
  }
  for (const o of marked.keys())
    assert.ok(
      needsAPerson.some((n) => owner(n) === o),
      `${o} needs a person but is not in needsAPerson`
    );
});

test('every page that lists the commands that need a person names each one', () => {
  /** @param {string} s */
  const flat = (s) => s.replace(/\s+/g, ' ');
  const pages = {
    'docs/cli.md': readFileSync(join(repo, 'docs', 'cli.md'), 'utf8'),
    'docs/agents.md': readFileSync(join(repo, 'docs', 'agents.md'), 'utf8'),
    'help exit-codes': topics['exit-codes'],
    'help approvals': topics.approvals,
  };
  for (const [page, text] of Object.entries(pages))
    for (const n of needsAPerson) assert.ok(flat(text).includes(`\`${n}`), `${page}: ${n}`);
});
