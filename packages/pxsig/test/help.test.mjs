/**
 * help.test.mjs — the help source (src/help/) against the code, the docs and the dashboard, so the
 * three cannot drift: every command and every flag the CLI reads has an entry and nothing else does,
 * every config key has a setting entry, docs/cli.md and docs/configuration.md name them all, every
 * example parses, and `pxsig --help` is unchanged.
 *
 *   node --test packages/pxsig/test/help.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/lib/args.mjs';
import { helpNames, helpSource, lookup } from '../src/help.mjs';
import { tools } from '../src/mcp.mjs';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(pkg, '..', '..');
/**
 * help/*.json as these tests read it.
 * @typedef {{ name: string, readBy?: string }} HelpFlag
 * @typedef {{ cmd: string, shows: string }} HelpExample
 * @typedef {{ flags?: HelpFlag[], examples?: HelpExample[], subcommands?: Record<string, HelpEntry> }} HelpEntry
 * @typedef {{ properties?: Record<string, SchemaNode>, $ref?: string, $defs?: Record<string, SchemaNode> }} SchemaNode
 */

/** @param {...string} p */
const read = (...p) => readFileSync(join(...p), 'utf8').replace(/\r\n/g, '\n');
/** @param {string} f */
const src = (f) => read(pkg, 'src', f);
/** @type {{ global: HelpEntry & { flags: HelpFlag[] }, commands: Record<string, HelpEntry>, settings: Record<string, unknown>, topics: Record<string, string> }} */
const { global, commands, settings, topics } = helpSource();
const cli = join(pkg, 'bin', 'pxsig.mjs');
/** @param {string[]} args */
const pxsig = (args) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PXSIG_FORMAT: 'plain', PXSIG_NO_DELEGATE: '1' },
  });

/** Every entry's flags: global, each command's and each subcommand's. */
const entries = () => [
  global,
  ...Object.values(commands).flatMap((c) => [c, ...Object.values(c.subcommands ?? {})]),
];
const documentedFlags = () =>
  new Set(
    entries().flatMap((e) =>
      (e.flags ?? []).filter((f) => f.readBy !== 'engine').map((f) => f.name)
    )
  );

/** The flags the npm CLI's entry points read, by the ways they read them. */
function readFlags() {
  const files = [
    'cli.mjs',
    'check.mjs',
    'approve.mjs',
    'serve.mjs',
    'report.mjs',
    'dashboard.mjs',
    'dashboard-check.mjs',
    'browser.mjs',
    'lib/workspace.mjs',
    'lib/term.mjs',
    'lib/enforcement.mjs',
  ];
  const pats = [
    /flags\.([a-zA-Z][\w]*)/g,
    /flags\[['"]([\w-]+)['"]\]/g,
    /\b(?:str|num)\(\s*['"]([\w-]+)['"]/g,
    /strFlag\(flags,\s*['"]([\w-]+)['"]/g,
    /\bs\(\s*'([\w-]+)'\)/g,
  ];
  const out = new Set();
  for (const f of files) {
    const s = src(f);
    for (const re of pats) for (const m of s.matchAll(re)) out.add(m[1]);
  }
  return out;
}

test('every command the CLI dispatches has an entry, and no other', () => {
  // cli.mjs has the block (the test fails on a TypeError otherwise).
  const block = /** @type {RegExpMatchArray} */ (
    src('cli.mjs').match(/\nconst commands = \{\n([\s\S]*?)\n\};\n/)
  )[1];
  const names = [...block.matchAll(/^ {2}(?:async )?([a-z0-9]+)(?:\(\) \{|: )/gm)].map((m) => m[1]);
  assert.deepEqual(names.sort(), Object.keys(commands).sort());
});

test('every flag the CLI reads has an entry, and every entry names a flag something reads', () => {
  const read = readFlags();
  const doc = documentedFlags();
  assert.deepEqual(
    [...read].filter((f) => !doc.has(f)).sort(),
    [],
    'read but not in help/commands.json'
  );
  assert.deepEqual(
    [...doc].filter((f) => !read.has(f)).sort(),
    [],
    'in help/commands.json but read by nothing'
  );
});

test('every config key has a setting entry, and no other', () => {
  /** @type {string[]} */
  const keys = [];
  /**
   * @param {SchemaNode} s
   * @param {string} p
   */
  const walk = (s, p) => {
    for (const [k, v] of Object.entries(s.properties ?? {})) {
      if (k === '$schema') continue;
      const key = p ? `${p}.${k}` : k;
      keys.push(key);
      // Follow this file's own definitions; a $ref to another file (workspace defaults → project) is that file's keys.
      const ref = v.$ref?.startsWith('#/$defs/') ? v.$ref.split('/').pop() : null;
      // A local $ref names one of the schema's own $defs.
      if (!v.$ref || ref)
        walk(ref ? /** @type {Record<string, SchemaNode>} */ (root.$defs)[ref] : v, key);
    }
  };
  /** @type {SchemaNode} */
  let root;
  for (const f of ['project.json', 'workspace.json']) {
    root = JSON.parse(read(pkg, 'schema', f));
    walk(root, '');
  }
  // gate.detail is a $ref to an object whose keys are documented under gate.detail itself.
  const own = [...new Set(keys)].filter((k) => !/^gate\.detail\./.test(k)).sort();
  assert.deepEqual(own, Object.keys(settings).sort());
});

test('docs/cli.md names every command and flag; docs/configuration.md every setting', () => {
  const md = read(repo, 'docs', 'cli.md');
  for (const c of Object.keys(commands))
    if (c !== 'help') assert.ok(md.includes(`pxsig ${c}`), `docs/cli.md: pxsig ${c}`);
  assert.ok(md.includes('pxsig help'), 'docs/cli.md: pxsig help');
  for (const e of entries())
    for (const f of e.flags ?? [])
      assert.ok(
        md.includes(`--${f.name}`) || (f.name === 'state' && md.includes('`state`')),
        `docs/cli.md: --${f.name}`
      );
  const conf = read(repo, 'docs', 'configuration.md');
  const keys = Object.keys(settings);
  // A nested key may be written whole (`store.dir`) or by its last part in its section's table.
  /** @param {string} k */
  const named = (k) => conf.includes(`\`${k}\``) || conf.includes(`\`${k.split('.').pop()}\``);
  for (const k of keys)
    assert.ok(
      named(k) || keys.some((x) => x.startsWith(`${k}.`) && named(x)),
      `docs/configuration.md: ${k}`
    );
});

test('every example is a command with flags it takes', () => {
  /** @param {string} cmd */
  const split = (cmd) => [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  const globals = new Set(global.flags.map((f) => f.name));
  for (const [name, c] of Object.entries(commands))
    for (const e of [c, ...Object.values(c.subcommands ?? {})])
      for (const x of e.examples ?? []) {
        const [bin, ...argv] = split(x.cmd);
        assert.equal(bin, 'pxsig', x.cmd);
        const { positional, flags } = parseArgs(argv);
        assert.equal(positional[0], name, `${x.cmd}: under ${name}`);
        const own = c.subcommands?.[positional[1]] ?? e;
        const known = new Set(
          [...globals, ...(c.flags ?? []), ...(own.flags ?? [])].map((f) =>
            typeof f === 'string' ? f : f.name
          )
        );
        for (const f of Object.keys(flags)) assert.ok(known.has(f), `${x.cmd}: --${f}`);
      }
});

test("cli.mjs's header lists the same commands", () => {
  // cli.mjs opens with its header comment.
  const header = /** @type {RegExpMatchArray} */ (src('cli.mjs').match(/\/\*\*([\s\S]*?)\*\//))[1];
  const listed = new Set(
    [...header.matchAll(/^ \* {3}([a-z0-9]+)\b/gm)].map((m) => m[1]).filter((c) => c !== 'pxsig')
  );
  assert.deepEqual(
    [...listed].sort(),
    Object.keys(commands)
      .filter((c) => c !== 'help')
      .sort()
  );
});

test("the dashboard's Commands rows are examples here, word for word", () => {
  const tsx = read(repo, 'packages', 'dashboard', 'src', 'views', 'Help.tsx');
  const copy = JSON.parse(read(repo, 'packages', 'dashboard', 'src', 'copy', 'en.json'));
  const rows = [
    // Help.tsx has the COMMANDS table.
    .../** @type {RegExpMatchArray} */ (
      tsx.match(/const COMMANDS[^=]*= \[([\s\S]*?)\];/)
    )[1].matchAll(/\['([^']+)', '([^']+)'\]/g),
  ];
  assert.ok(rows.length >= 5);
  const examples = new Map(
    entries().flatMap((e) => (e.examples ?? []).map((x) => [x.cmd, x.shows]))
  );
  for (const [, cmd, key] of rows) {
    const text = key.split('.').reduce((o, k) => o[k], copy);
    assert.equal(examples.get(cmd), text, `${cmd}: "${text}"`);
  }
});

test('pxsig --help and pxsig help print the header, as before', () => {
  const header =
    // cli.mjs opens with its header comment.
    /** @type {RegExpMatchArray} */ (src('cli.mjs').match(/\/\*\*([\s\S]*?)\*\//))[1]
      .replace(/^ \* ?/gm, '')
      .trim() + '\n';
  assert.equal(pxsig(['--help']).stdout.replace(/\r\n/g, '\n'), header);
  assert.equal(pxsig(['help']).stdout.replace(/\r\n/g, '\n'), header);
});

test('a command, subcommand, topic or setting has its own page; an unknown name exits 2 with the nearest', () => {
  assert.match(pxsig(['check', '--help']).stdout, /^## pxsig check — /);
  assert.match(
    pxsig(['help', 'approve', 'apply']).stdout,
    /^## pxsig approve apply — .*\n[\s\S]*\| 3 \| Not a person at a terminal \|/
  );
  assert.match(
    pxsig(['list', 'changed', '--help']).stdout,
    /^## pxsig list — /,
    'an argument is not a subcommand'
  );
  assert.match(pxsig(['help', 'exit-codes']).stdout, /^# Exit codes/);
  assert.match(
    pxsig(['help', 'dashboard']).stdout,
    /## pxsig dashboard[\s\S]*# The dashboard on another design system/,
    'command and topic together'
  );
  const s = JSON.parse(pxsig(['help', 'gate.threshold', '--json']).stdout);
  assert.deepEqual([s.kind, s.entry.default], ['setting', '24']);
  const bad = pxsig(['help', 'chek']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /nearest: check\b/);
});

test('every topic and every setting is reachable by name', () => {
  for (const t of Object.keys(topics)) assert.ok(lookup([t]), t);
  for (const k of Object.keys(settings)) assert.equal(lookup([k])?.name, k);
  assert.ok(helpNames().includes('approve verify'));
});

test('a setting whose values are one string has its page', () => {
  for (const k of ['approvals.identity', 'approvals.level']) {
    const r = pxsig(['help', k]);
    assert.equal(r.status, 0, `${k}: ${r.stderr}`);
    assert.match(r.stdout, new RegExp(`^## ${k.replace('.', '\\.')}[\\s\\S]*Values`), k);
  }
  assert.match(pxsig(['help', 'approvals.identity']).stdout, /none \| git-email/);
});

test("the MCP's pxsig_help gives the same data, read-only", async () => {
  // pxsig_help is one of the tools; its run takes `{ name? }` and lists the names without one.
  const t = /** @type {{ run: (args: { name?: string }) => Promise<{ names: string[] }> }} */ (
    tools.find((x) => x.name === 'pxsig_help')
  );
  assert.ok((await t.run({})).names.includes('check'));
  assert.deepEqual(await t.run({ name: 'approve verify' }), {
    kind: 'command',
    name: 'approve verify',
    // approve has subcommands.
    entry: /** @type {Record<string, HelpEntry>} */ (commands.approve.subcommands).verify,
  });
  await assert.rejects(t.run({ name: 'nope' }), /nearest/);
});
