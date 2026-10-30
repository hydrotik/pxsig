/**
 * help.mjs — `pxsig help <name>`, `pxsig <command> --help` and the MCP's pxsig_help, from one source:
 * src/help/commands.json (commands, subcommands, flags, exits, examples), src/help/settings.json
 * (every config key) and src/help/topics/*.md. `pxsig help` alone and `pxsig --help` print the
 * index built from the same files (helpIndex); `pxsig help topics` lists the topics.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distance } from './lib/args.mjs';

/** @import { Block, Cell, HelpCommandEntry, HelpFlag, HelpFound, HelpIndex, HelpSetting, HelpSource } from './types/t6.js' */

const dir = fileURLToPath(new URL('./help/', import.meta.url));
/**
 * One of pxsig's own help files, parsed.
 * @param {string} f
 * @returns {unknown}
 */
const json = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

/** @type {HelpSource | null} */
let cache = null;
/**
 * `{ global, commands, needsAPerson, settings, topics }`, read once.
 * @returns {HelpSource}
 */
export function helpSource() {
  if (cache) return cache;
  // The package's own help files, in the shape types/t6.d.ts describes (test/help.test.mjs reads them).
  const { global, commands, needsAPerson } =
    /** @type {Pick<HelpSource, 'global' | 'commands' | 'needsAPerson'>} */ (json('commands.json'));
  const { settings } = /** @type {Pick<HelpSource, 'settings'>} */ (json('settings.json'));
  /** @type {Record<string, string>} */
  const topics = {};
  const td = join(dir, 'topics');
  if (existsSync(td))
    for (const f of readdirSync(td)
      .filter((n) => n.endsWith('.md'))
      .sort())
      topics[f.slice(0, -3)] = readFileSync(join(td, f), 'utf8').replace(/\r\n/g, '\n');
  return (cache = { global, commands, needsAPerson, settings, topics });
}

/**
 * Every name `help` answers to: commands, `command sub`, topics and settings.
 * @returns {string[]}
 */
export function helpNames() {
  const { commands, settings, topics } = helpSource();
  const out = [];
  for (const [c, e] of Object.entries(commands)) {
    out.push(c);
    for (const s of Object.keys(e.subcommands ?? {})) out.push(`${c} ${s}`);
  }
  return [
    ...new Set([...out, 'global', 'topics', ...Object.keys(topics), ...Object.keys(settings)]),
  ];
}

/**
 * The `n` help names nearest to `name`.
 * @param {string} name
 * @param {number} [n]
 * @returns {string[]}
 */
export function nearestNames(name, n = 5) {
  const q = name.toLowerCase();
  return helpNames()
    .map((x) => ({
      x,
      d:
        x.toLowerCase().includes(q) || q.includes(x.toLowerCase())
          ? 0
          : distance(q, x.toLowerCase(), { swaps: false }),
    }))
    .sort((a, b) => a.d - b.d || a.x.localeCompare(b.x))
    .slice(0, n)
    .map((r) => r.x);
}

/**
 * The entry for `words` (`['check']`, `['approve', 'apply']`, `['approvals']`, `['gate.threshold']`):
 * `{ kind: 'command' | 'topic' | 'setting', name, entry, topic? }`, or null. A name that is both a
 * command and a topic (`dashboard`) is the command, with the topic attached.
 * @param {readonly (string | undefined)[]} words
 * @returns {HelpFound | null}
 */
export function lookup(words) {
  const { commands, settings, topics } = helpSource();
  const [first, second] = words;
  if (!first) return null;
  if (first === 'global' && !second) {
    const g = helpSource().global;
    return {
      kind: 'command',
      name: 'global',
      entry: { summary: g.summary, usage: ['pxsig <command> [options]'], flags: g.flags },
    };
  }
  const cmd = commands[first];
  if (cmd) {
    // An empty second word ('') is no subcommand, as when there is none.
    const sub = second ? cmd.subcommands?.[second] : undefined;
    if (second && !sub) return null;
    return {
      kind: 'command',
      name: sub ? `${first} ${second}` : first,
      entry: sub ?? cmd,
      parent: sub ? cmd : null,
      ...(topics[first] && !sub ? { topic: topics[first] } : {}),
    };
  }
  if (second) return null;
  if (first === 'topics') return { kind: 'topic', name: 'topics', topic: topicList() };
  if (topics[first]) return { kind: 'topic', name: first, topic: topics[first] };
  if (settings[first]) return { kind: 'setting', name: first, entry: settings[first] };
  return null;
}

/** A topic's title: its first heading. @param {string} md */
const topicTitle = (md) => /^# (.+)$/m.exec(md)?.[1] ?? '';

/**
 * `pxsig help topics`: every topic with its title, as a topic page of its own.
 * @returns {string}
 */
function topicList() {
  const { topics } = helpSource();
  const rows = Object.entries(topics).map(([n, md]) => `- \`${n}\`: ${topicTitle(md)}`);
  return ['# Topics', '', ...rows, '', '`pxsig help <topic>` prints one.', ''].join('\n');
}

/**
 * `pxsig help` alone and `pxsig --help`: every command and subcommand with its summary and usage,
 * the commands that need a person, the topics, and how to read more. `blocks` for lib/term.mjs,
 * `data` for --json.
 * @param {string} [CMD]
 * @returns {{ blocks: Block[], data: HelpIndex }}
 */
export function helpIndex(CMD = 'pxsig') {
  const { commands, needsAPerson, topics } = helpSource();
  /** @type {HelpIndex['commands']} */
  const rows = [];
  for (const [c, e] of Object.entries(commands)) {
    rows.push({ name: c, summary: e.summary, usage: e.usage });
    for (const [s, se] of Object.entries(e.subcommands ?? {}))
      rows.push({ name: `${c} ${s}`, summary: se.summary, usage: se.usage });
  }
  const summary = 'visual regression for Storybook stories.';
  const usage = [...new Set(rows.flatMap((r) => r.usage))];
  const topicNames = Object.keys(topics);
  /** @type {Block[]} */
  const blocks = [
    { h: CMD, sub: summary },
    { list: [`${CMD} [command] [arguments] [options]  (no command: status)`] },
    { h: 'Commands' },
    {
      table: {
        cols: [
          { key: 'c', label: 'Command' },
          { key: 'm', label: 'What it does' },
        ],
        rows: rows.map((r) => ({ c: r.name, m: r.summary })),
      },
    },
    { h: 'Usage' },
    { list: usage },
    { h: 'Needs a person at a terminal', sub: 'exit 3 when piped, in CI or under an assistant' },
    { list: needsAPerson },
    { note: `Topics: ${topicNames.join(', ')}.` },
    {
      title: 'More',
      next: [
        [`${CMD} help <name>`, 'one command, subcommand, topic or setting'],
        [`${CMD} help topics`, 'the topics, with their titles'],
        [`${CMD} help global`, 'the options every command takes'],
        [`${CMD} <command> --help`, 'the same page as help <command>'],
        [`${CMD} version`, "this CLI's, the engine's and the UI contract's versions (--version)"],
      ],
    },
  ];
  return {
    blocks,
    data: { kind: 'index', name: CMD, summary, commands: rows, needsAPerson, topics: topicNames },
  };
}

/** @param {HelpFlag} f */
const flagName = (f) => `--${f.name}${f.value ? ` <${f.value}>` : ''}`;

/**
 * lib/term.mjs blocks for a lookup result.
 * @param {HelpFound} found
 * @param {string} [CMD]
 * @returns {Block[]}
 */
export function helpBlocks(found, CMD = 'pxsig') {
  // `entry` is read only after the topic case returns: a setting's keys in the setting case, a
  // command's below it (lookup pairs each kind with its entry).
  const { entry, name } = /** @type {HelpFound & { entry: HelpCommandEntry & HelpSetting }} */ (
    found
  );
  if (found.kind === 'topic') return [{ text: found.topic }];
  if (found.kind === 'setting') {
    /** @type {[string, Cell][]} */
    const kv = [
      ['File', entry.file],
      ['Meaning', entry.meaning],
    ];
    // Most settings list their values; a few write them as one string.
    if (entry.values)
      kv.push(['Values', Array.isArray(entry.values) ? entry.values.join(', ') : entry.values]);
    if (entry.default != null) kv.push(['Default', entry.default]);
    if (entry.operation) kv.push(['Effect', entry.operation]);
    if (entry.flag) kv.push(['Flag', entry.flag]);
    if (entry.env) kv.push(['Environment', entry.env]);
    return [{ h: name, sub: 'setting' }, { kv }];
  }
  /** @type {Block[]} */
  const blocks = [{ h: `${CMD} ${name}`, sub: entry.summary }, { list: entry.usage }];
  if (entry.subcommands)
    blocks.push(
      { h: 'Subcommands' },
      {
        table: {
          cols: [
            { key: 's', label: 'Subcommand' },
            { key: 'm', label: 'What it does' },
          ],
          rows: Object.entries(entry.subcommands).map(([s, e]) => ({
            s: `${name} ${s}`,
            m: e.summary,
          })),
        },
      }
    );
  if (entry.flags?.length)
    blocks.push(
      { h: 'Flags' },
      {
        table: {
          cols: [
            { key: 'f', label: 'Flag' },
            { key: 'd', label: 'Default' },
            { key: 'm', label: 'Meaning' },
          ],
          rows: entry.flags.map((f) => ({
            f: flagName(f),
            d: f.default ?? '',
            m: [f.meaning, f.setting && `Setting: ${f.setting}.`, f.env && `Environment: ${f.env}.`]
              .filter(Boolean)
              .join(' '),
          })),
        },
      }
    );
  if (entry.exits)
    blocks.push(
      { h: 'Exit codes' },
      {
        table: {
          cols: [
            { key: 'c', label: 'Code' },
            { key: 'm', label: 'Meaning' },
          ],
          rows: Object.entries(entry.exits).map(([c, m]) => ({ c, m })),
        },
      }
    );
  if (entry.effects?.length) blocks.push({ kv: [['Effects', entry.effects.join(', ')]] });
  if (entry.examples?.length)
    blocks.push({ title: 'Examples', next: entry.examples.map((x) => [x.cmd, x.shows]) });
  const see = entry.seeAlso ?? found.parent?.seeAlso;
  if (see?.length)
    blocks.push({
      note: `See also: ${see.map((s) => `${CMD} help ${s}`).join(' · ')} · ${CMD} help global`,
    });
  if (found.topic) blocks.push({ text: found.topic });
  return blocks;
}

/**
 * What `--json` and the MCP return.
 * @param {HelpFound} found
 */
export const helpData = (found) => ({
  kind: found.kind,
  name: found.name,
  ...(found.entry ? { entry: found.entry } : {}),
  ...(found.topic ? { topic: found.topic } : {}),
});
