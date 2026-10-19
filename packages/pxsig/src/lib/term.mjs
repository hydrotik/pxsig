/**
 * term.mjs — one output layer for every pxsig CLI, readable by people and by agents.
 *
 * Commands build a document out of blocks (heading, kv, table, list, note, next) and hand it to
 * `emit()`, which renders it for whoever is reading:
 *
 *   pretty  a terminal: colour, symbols, aligned tables, clickable ids (OSC 8), a spinner on stderr,
 *           inline images in iTerm2 / WezTerm.
 *   plain   anything else — Claude Code, Codex and CI run commands with stdout piped: Markdown.
 *           No ANSI, no carriage-return redraws, nothing that reads as noise in a transcript;
 *           tables are GFM, image paths are absolute so the agent can open them, and a "Next"
 *           section names the exact commands to run.
 *   json    the command's data as one JSON document on stdout (logs stay on stderr).
 *
 * Choice: --json / --plain / --pretty, else PXSIG_FORMAT, else pretty only on a TTY that is not
 * CI or a known agent. Colour follows NO_COLOR / FORCE_COLOR.
 */
import { pathToFileURL } from 'node:url';

const env = process.env;
const AGENT = Boolean(
  env.CLAUDECODE ||
  env.CLAUDE_CODE_ENTRYPOINT ||
  env.CODEX_SANDBOX ||
  env.CODEX_SANDBOX_NETWORK_DISABLED ||
  env.PXSIG_AGENT
);

/**
 * A person at a real terminal: stdin and stdout are TTYs and nothing says CI or an agent. Baseline
 * writes in bulk require this, so a model (whose commands run piped) cannot perform them.
 */
export const humanAtTerminal = () => Boolean(process.stdin.isTTY && process.stdout.isTTY && !env.CI && !AGENT);

/** Ask a question on the terminal; resolves with the typed line. */
export async function ask(question) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export function pickFormat(flags = {}) {
  if (flags.json) return 'json';
  if (flags.plain || flags.markdown) return 'plain';
  if (flags.pretty) return 'pretty';
  const f = env.PXSIG_FORMAT;
  if (f === 'json' || f === 'plain' || f === 'pretty') return f;
  return process.stdout.isTTY && !env.CI && !AGENT ? 'pretty' : 'plain';
}

const colorOn = (format) => format === 'pretty' && !('NO_COLOR' in env) && env.FORCE_COLOR !== '0';

// --- styling ------------------------------------------------------------------------------------

const SGR = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  gray: [90, 39],
};
export function painter(format) {
  const on = colorOn(format);
  const p = {};
  for (const [k, [a, b]] of Object.entries(SGR))
    p[k] = (s) => (on ? `\x1b[${a}m${s}\x1b[${b}m` : String(s));
  // OSC 8 hyperlink: terminals that support it make the text clickable; others print the text.
  p.link = (text, url) => (on && url ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : String(text));
  return p;
}

/** Entry states, with the colour and symbol a person scans for. */
export const STATES = {
  pass: { sym: '✓', color: 'green' },
  drift: { sym: '≈', color: 'green' },
  approved: { sym: '✓', color: 'cyan' },
  changed: { sym: '◆', color: 'yellow' },
  flaky: { sym: '~', color: 'magenta' },
  rejected: { sym: '✗', color: 'red' },
  error: { sym: '✗', color: 'red' },
  skipped: { sym: '·', color: 'gray' },
};

// oxlint-disable-next-line no-control-regex -- matching ANSI escapes is the point
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b]*\x1b\\/g;
const width = (s) => [...String(s).replace(ANSI_RE, '')].length;
const pad = (s, n, right = false) => {
  const fill = ' '.repeat(Math.max(0, n - width(s)));
  return right ? fill + s : s + fill;
};
const mdCell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');

// --- blocks -------------------------------------------------------------------------------------

/**
 * Blocks:
 *   { h: 'Title', sub?: 'muted text' }
 *   { kv: [[label, value], ...] }
 *   { table: { cols: [{ key, label, right? }], rows: [{...}], more?: n } }
 *   { list: [text, ...] }
 *   { note: text, tone?: 'ok' | 'warn' | 'bad' }
 *   { next: [[command, why], ...] }
 *   { images: [{ label, path }] }
 * Cell values may be { text, color?, url? } for styled cells.
 */
function renderPretty(blocks, p) {
  const out = [];
  const cell = (v) => {
    if (Array.isArray(v)) return v.map(cell).join('   ');
    if (v && typeof v === 'object') {
      const t = v.url ? p.link(v.text, v.url) : String(v.text);
      return v.color ? p[v.color](t) : t;
    }
    return String(v ?? '');
  };
  const tone = { ok: p.green, warn: p.yellow, bad: p.red };
  for (const b of blocks) {
    if (b.h) out.push('', `${p.bold(b.h)}${b.sub ? `  ${p.gray(b.sub)}` : ''}`);
    else if (b.kv) {
      const w = Math.max(...b.kv.map(([k]) => width(k)));
      for (const [k, v] of b.kv) out.push(`  ${p.gray(pad(k, w))}  ${cell(v)}`);
    } else if (b.table) {
      const { cols, rows, more } = b.table;
      if (!rows.length) continue;
      const cells = rows.map((r) => cols.map((c) => cell(r[c.key])));
      const w = cols.map((c, i) => Math.max(width(c.label), ...cells.map((r) => width(r[i]))));
      out.push('  ' + cols.map((c, i) => p.gray(pad(c.label, w[i], c.right))).join('  '));
      for (const r of cells)
        out.push(
          '  ' +
            r
              .map((v, i) => pad(v, w[i], cols[i].right))
              .join('  ')
              .trimEnd()
        );
      if (more)
        out.push(p.gray(`  … ${more} more${b.table.moreHint ? ` (${b.table.moreHint})` : ''}`));
    } else if (b.list) for (const t of b.list) out.push(`  ${p.gray('•')} ${cell(t)}`);
    else if (b.note) out.push(`  ${(tone[b.tone] ?? p.gray)(b.note)}`);
    else if (b.next?.length) {
      out.push('', p.bold('Next'));
      const w = Math.max(...b.next.map(([c]) => width(c)));
      for (const [c, why] of b.next) out.push(`  ${p.cyan(pad(c, w))}  ${p.gray(why)}`);
    } else if (b.images) for (const im of b.images) out.push(...inlineImage(im, p));
  }
  return out.join('\n').replace(/^\n/, '') + '\n';
}

function renderMarkdown(blocks) {
  const out = [];
  const cell = (v) => {
    if (Array.isArray(v)) return v.map(cell).join(' · ');
    if (v && typeof v === 'object')
      return v.url && !v.noLinkInPlain ? `[${v.text}](${v.url})` : String(v.text);
    return String(v ?? '');
  };
  let first = true;
  for (const b of blocks) {
    if (b.h) {
      out.push(`${first ? '##' : '###'} ${b.h}${b.sub ? ` — ${b.sub}` : ''}`, '');
      first = false;
    } else if (b.kv) {
      for (const [k, v] of b.kv) out.push(`- **${k}:** ${cell(v)}`);
      out.push('');
    } else if (b.table) {
      const { cols, rows, more } = b.table;
      if (!rows.length) continue;
      out.push(`| ${cols.map((c) => c.label).join(' | ')} |`);
      out.push(`|${cols.map((c) => (c.right ? ' ---: ' : ' --- ')).join('|')}|`);
      for (const r of rows) out.push(`| ${cols.map((c) => mdCell(cell(r[c.key]))).join(' | ')} |`);
      if (more) out.push('', `_…${more} more${b.table.moreHint ? ` (${b.table.moreHint})` : ''}._`);
      out.push('');
    } else if (b.list) {
      for (const t of b.list) out.push(`- ${cell(t)}`);
      out.push('');
    } else if (b.note) out.push(b.tone === 'bad' ? `**${b.note}**` : b.note, '');
    else if (b.next?.length) {
      out.push('**Next**', '');
      for (const [c, why] of b.next) out.push(`- \`${c}\` — ${why}`);
      out.push('');
    } else if (b.images) {
      // Absolute paths: an agent can open the PNG with its file/image tool.
      for (const im of b.images)
        out.push(`- ${im.label}: ${im.path}${im.missing ? ' (missing)' : ''}`);
      out.push('');
    }
  }
  return out.join('\n').trimEnd() + '\n';
}

/** iTerm2 inline images (also WezTerm); elsewhere a clickable file path. */
function inlineImage({ label, path, data, missing }, p) {
  const prog = env.TERM_PROGRAM ?? '';
  const inline =
    colorOn('pretty') &&
    data &&
    (prog === 'iTerm.app' || prog === 'WezTerm' || env.LC_TERMINAL === 'iTerm2');
  const head = `  ${p.gray(label)}  ${missing ? p.red('missing') : p.link(path, pathToFileURL(path).href)}`;
  if (!inline) return [head];
  return [
    head,
    `  \x1b]1337;File=inline=1;height=12;preserveAspectRatio=1:${data.toString('base64')}\x07`,
  ];
}

/** Print a document. `data` is what --json prints. */
export function emit(format, blocks, data) {
  if (format === 'json') process.stdout.write(JSON.stringify(data ?? blocks, null, 2) + '\n');
  else if (format === 'pretty') process.stdout.write(renderPretty(blocks, painter(format)));
  else process.stdout.write(renderMarkdown(blocks));
}

/** A spinner on stderr in pretty mode; in plain / json mode one line at start and one at the end. */
export function progress(format, label) {
  const p = painter(format);
  const t0 = Date.now();
  const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
  if (format !== 'pretty' || !process.stderr.isTTY) {
    if (format === 'plain') process.stderr.write(`${label}…\n`);
    return {
      update() {},
      done: (msg) => format === 'plain' && process.stderr.write(`${msg ?? label} (${secs()})\n`),
    };
  }
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  let i = 0;
  let text = label;
  const draw = () =>
    process.stderr.write(
      `\r\x1b[2K${p.cyan(frames[i++ % frames.length])} ${text} ${p.gray(secs())}`
    );
  const timer = setInterval(draw, 80);
  draw();
  return {
    update: (t) => (text = t),
    done: (msg, ok = true) => {
      clearInterval(timer);
      process.stderr.write(
        `\r\x1b[2K${ok ? p.green('✓') : p.red('✗')} ${msg ?? label} ${p.gray(secs())}\n`
      );
    },
  };
}

/** A state cell: symbol + name, coloured in pretty mode, plain words in Markdown. */
export const stateCell = (st) => ({
  text: `${STATES[st]?.sym ?? '?'} ${st}`,
  color: STATES[st]?.color,
});
