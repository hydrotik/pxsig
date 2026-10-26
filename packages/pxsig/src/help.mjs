/**
 * help.mjs — `pxsig help <name>`, `pxsig <command> --help` and the MCP's pxsig_help, from one source:
 * src/help/commands.json (commands, subcommands, flags, exits, examples), src/help/settings.json
 * (every config key) and src/help/topics/*.md. `pxsig help` alone and `pxsig --help` keep printing
 * cli.mjs's header (unchanged).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('./help/', import.meta.url));
const json = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

let cache = null;
/** `{ global, commands, settings, topics }`, read once. */
export function helpSource() {
  if (cache) return cache;
  const { global, commands } = json('commands.json');
  const { settings } = json('settings.json');
  const topics = {};
  const td = join(dir, 'topics');
  if (existsSync(td)) for (const f of readdirSync(td).filter((n) => n.endsWith('.md')).sort()) topics[f.slice(0, -3)] = readFileSync(join(td, f), 'utf8').replace(/\r\n/g, '\n');
  return (cache = { global, commands, settings, topics });
}

/** Every name `help` answers to: commands, `command sub`, topics and settings. */
export function helpNames() {
  const { commands, settings, topics } = helpSource();
  const out = [];
  for (const [c, e] of Object.entries(commands)) {
    out.push(c);
    for (const s of Object.keys(e.subcommands ?? {})) out.push(`${c} ${s}`);
  }
  return [...new Set([...out, 'global', ...Object.keys(topics), ...Object.keys(settings)])];
}

/** Edit distance, for "did not find x; nearest: …". */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function nearestNames(name, n = 5) {
  const q = name.toLowerCase();
  return helpNames()
    .map((x) => ({ x, d: x.toLowerCase().includes(q) || q.includes(x.toLowerCase()) ? 0 : distance(q, x.toLowerCase()) }))
    .sort((a, b) => a.d - b.d || a.x.localeCompare(b.x))
    .slice(0, n)
    .map((r) => r.x);
}

/**
 * The entry for `words` (`['check']`, `['approve', 'apply']`, `['approvals']`, `['gate.threshold']`):
 * `{ kind: 'command' | 'topic' | 'setting', name, entry, topic? }`, or null. A name that is both a
 * command and a topic (`dashboard`) is the command, with the topic attached.
 */
export function lookup(words) {
  const { commands, settings, topics } = helpSource();
  const [first, second] = words;
  if (!first) return null;
  if (first === 'global' && !second) {
    const g = helpSource().global;
    return { kind: 'command', name: 'global', entry: { summary: g.summary, usage: ['pxsig <command> [options]'], flags: g.flags } };
  }
  const cmd = commands[first];
  if (cmd) {
    const sub = second && cmd.subcommands?.[second];
    if (second && !sub) return null;
    return { kind: 'command', name: sub ? `${first} ${second}` : first, entry: sub ?? cmd, parent: sub ? cmd : null, ...(topics[first] && !sub ? { topic: topics[first] } : {}) };
  }
  if (second) return null;
  if (topics[first]) return { kind: 'topic', name: first, topic: topics[first] };
  if (settings[first]) return { kind: 'setting', name: first, entry: settings[first] };
  return null;
}

const flagName = (f) => `--${f.name}${f.value ? ` <${f.value}>` : ''}`;

/** lib/term.mjs blocks for a lookup result. */
export function helpBlocks(found, CMD = 'pxsig') {
  const { entry, name } = found;
  if (found.kind === 'topic') return [{ text: found.topic }];
  if (found.kind === 'setting') {
    const kv = [['File', entry.file], ['Meaning', entry.meaning]];
    if (entry.values) kv.push(['Values', entry.values.join(', ')]);
    if (entry.default != null) kv.push(['Default', entry.default]);
    if (entry.operation) kv.push(['Effect', entry.operation]);
    if (entry.flag) kv.push(['Flag', entry.flag]);
    if (entry.env) kv.push(['Environment', entry.env]);
    return [{ h: name, sub: 'setting' }, { kv }];
  }
  const blocks = [{ h: `${CMD} ${name}`, sub: entry.summary }, { list: entry.usage }];
  if (entry.subcommands)
    blocks.push({ h: 'Subcommands' }, { table: { cols: [{ key: 's', label: 'Subcommand' }, { key: 'm', label: 'What it does' }], rows: Object.entries(entry.subcommands).map(([s, e]) => ({ s: `${name} ${s}`, m: e.summary })) } });
  if (entry.flags?.length) blocks.push({ h: 'Flags' }, { table: { cols: [{ key: 'f', label: 'Flag' }, { key: 'd', label: 'Default' }, { key: 'm', label: 'Meaning' }], rows: entry.flags.map((f) => ({ f: flagName(f), d: f.default ?? '', m: [f.meaning, f.setting && `Setting: ${f.setting}.`, f.env && `Environment: ${f.env}.`].filter(Boolean).join(' ') })) } });
  if (entry.exits) blocks.push({ h: 'Exit codes' }, { table: { cols: [{ key: 'c', label: 'Code' }, { key: 'm', label: 'Meaning' }], rows: Object.entries(entry.exits).map(([c, m]) => ({ c, m })) } });
  if (entry.effects?.length) blocks.push({ kv: [['Effects', entry.effects.join(', ')]] });
  if (entry.examples?.length) blocks.push({ title: 'Examples', next: entry.examples.map((x) => [x.cmd, x.shows]) });
  const see = entry.seeAlso ?? found.parent?.seeAlso;
  if (see?.length) blocks.push({ note: `See also: ${see.map((s) => `${CMD} help ${s}`).join(' · ')} · ${CMD} help global` });
  if (found.topic) blocks.push({ text: found.topic });
  return blocks;
}

/** What `--json` and the MCP return. */
export const helpData = (found) => ({ kind: found.kind, name: found.name, ...(found.entry ? { entry: found.entry } : {}), ...(found.topic ? { topic: found.topic } : {}) });
