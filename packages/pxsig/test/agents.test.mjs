/**
 * agents.test.mjs — coding assistants (docs/agents.md): one case per marker row, the
 * editor variables that are not markers, refusals that name the assistant, plain output, `agent` on
 * log lines, `doctor`'s line, and `pxsig setup` (prints always; writes only on a yes and only what
 * is absent; never outside the repository). The recipes in docs/agents.md are the module's, word for
 * word, and parse.
 *
 *   node --test packages/pxsig/test/agents.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { agentName, detectAgent, MARKERS, NOT_MARKERS } from '../src/lib/agents.mjs';
import { ASSISTANTS, SNIPPET } from '../src/lib/assistants.mjs';
import { stamp } from '../src/lib/approvals.mjs';
import { humanAtTerminal, pickFormat, whyNotPerson } from '../src/lib/term.mjs';
import { setupCommand } from '../src/setup.mjs';
import { fixture, rustBin, tempDir, testEnv, testHome } from './fixture.mjs';
/** @import { DetectedAgent } from '../src/types.js' */

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(pkg, '..', '..');
const cli = join(pkg, 'bin', 'pxsig.mjs');

/** This process's environment without any marker or CI, so a spawned pxsig sees only what a test sets. */
const MARKER_VARS = MARKERS.flatMap((m) => m.vars);
const bare = () =>
  Object.fromEntries(
    Object.entries(testEnv(testHome)).filter(([k]) => !MARKER_VARS.includes(k) && k !== 'CI')
  );
/**
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @param {string} [cwd]
 */
const pxsig = (args, env = {}, cwd = repo) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...bare(),
      PXSIG_NO_DELEGATE: '1',
      PXSIG_FORMAT: 'plain',
      PXSIG_URL: 'http://127.0.0.1:1',
      PXSIG_BIN: rustBin,
      ...env,
    },
  });

/** @type {[Record<string, string>, string][]} */
const ROWS = [
  [{ PXSIG_AGENT: '1' }, 'agent'],
  [{ PXSIG_AGENT: 'my-bot' }, 'my-bot'],
  [{ AI_AGENT: 'github_copilot_vscode_agent' }, 'copilot'],
  [{ AI_AGENT: 'claude-code_2-1_agent' }, 'claude-code'],
  [{ AI_AGENT: 'opencode' }, 'opencode'],
  [{ COPILOT_AGENT: '1' }, 'copilot'],
  [{ COPILOT_CLI: '1' }, 'copilot'],
  [{ COPILOT_AGENT_SESSION_ID: 'abc' }, 'copilot'],
  [{ CLAUDECODE: '1' }, 'claude-code'],
  [{ CLAUDE_CODE_ENTRYPOINT: 'cli' }, 'claude-code'],
  [{ CLAUDE_CODE_CHILD_SESSION: '1' }, 'claude-code'],
  [{ CODEX_THREAD_ID: 't1' }, 'codex'],
  [{ CODEX_CI: '1' }, 'codex'],
  [{ CODEX_SANDBOX: 'seatbelt' }, 'codex'],
  [{ CODEX_SANDBOX_NETWORK_DISABLED: '1' }, 'codex'],
  [{ GEMINI_CLI: '1' }, 'gemini-cli'],
  [{ CURSOR_AGENT: '1' }, 'cursor'],
  [{ CURSOR_SANDBOX: 'native' }, 'cursor'],
  [{ CLINE_ACTIVE: 'true' }, 'cline'],
  [{ ROO_ACTIVE: 'true' }, 'roo-code'],
  [{ AGENT: 'amp' }, 'amp'],
  [{ AMP_CURRENT_THREAD_ID: 'T-1' }, 'amp'],
  [{ OPENCODE: '1' }, 'opencode'],
];

test('every marker row names its assistant', () => {
  for (const [env, name] of ROWS) assert.equal(agentName(env), name, JSON.stringify(env));
  // Every variable in the table has a case above.
  const covered = new Set(ROWS.flatMap(([env]) => Object.keys(env)));
  for (const v of MARKER_VARS) assert.ok(covered.has(v), `no case for ${v}`);
});

test('editor variables, empty values and another AGENT are not markers', () => {
  assert.equal(agentName({}), null);
  for (const v of NOT_MARKERS)
    assert.equal(agentName({ [v]: v === 'TERM_PROGRAM' ? 'vscode' : '1' }), null, v);
  assert.equal(
    agentName({
      TERM_PROGRAM: 'zed',
      ZED_TERM: 'true',
      CURSOR_TRACE_ID: 'x',
      VSCODE_INJECTION: '1',
    }),
    null
  );
  assert.equal(agentName({ AI_AGENT: '', CLAUDECODE: '' }), null);
  assert.equal(agentName({ AGENT: 'other' }), null);
});

test('a marker value is cleaned before it is printed or logged', () => {
  // PXSIG_AGENT is a marker, so an agent is detected.
  const a = /** @type {DetectedAgent} */ (
    detectAgent({ PXSIG_AGENT: 'x y/$(z)\n' + 'q'.repeat(80) })
  );
  assert.match(a.name, /^[\w.-]{1,64}$/);
  assert.match(a.value, /^[\w.-]{1,64}$/);
});

test('a real terminal under a marker is not a person; the reason names the assistant', () => {
  const tty = { stdin: true, stdout: true };
  assert.equal(humanAtTerminal({ e: {}, ...tty }), true);
  assert.equal(whyNotPerson({ e: {}, ...tty }), null);
  for (const [env, name] of ROWS) {
    assert.equal(humanAtTerminal({ e: env, ...tty }), false, name);
    assert.match(
      // A null (a person) fails the match on its own.
      /** @type {string} */ (whyNotPerson({ e: env, ...tty })),
      new RegExp(`^refused under ${name} \\(${Object.keys(env)[0]}=`)
    );
  }
  assert.equal(
    whyNotPerson({ e: { AI_AGENT: 'github_copilot_vscode_agent' }, ...tty }),
    'refused under copilot (AI_AGENT=github_copilot_vscode_agent)'
  );
  assert.equal(whyNotPerson({ e: { CI: 'true' }, ...tty }), 'refused in CI (CI is set)');
  assert.equal(whyNotPerson({ e: {}, stdin: true, stdout: false }), 'refused: output is piped');
  assert.equal(
    whyNotPerson({ e: {}, stdin: false, stdout: true }),
    'refused: input is not a terminal'
  );
});

test('output is plain under every marker, even on a terminal', () => {
  assert.equal(pickFormat({}, { e: {}, tty: true }), 'pretty');
  for (const [env, name] of ROWS)
    assert.equal(pickFormat({}, { e: env, tty: true }), 'plain', name);
  assert.equal(
    pickFormat({ pretty: true }, { e: { GEMINI_CLI: '1' }, tty: true }),
    'pretty',
    'a flag still wins'
  );
});

test('log lines carry `agent` under a marker, and nothing without one', () => {
  const line = { at: 'now', id: 'x', by: null, via: 'mcp' };
  assert.equal(stamp(line, {}).agent, undefined);
  assert.equal(stamp(line, { AI_AGENT: 'github_copilot_vscode_agent' }).agent, 'copilot');
  assert.equal(stamp(line, { CLINE_ACTIVE: 'true' }).agent, 'cline');
  assert.equal('by' in stamp(line, { CLINE_ACTIVE: 'true' }), false);
});

test("a person's decision carries no `agent`, even from a server started under a marker", () => {
  const env = { CLAUDECODE: '1' };
  for (const via of ['dashboard', 'cli'])
    assert.equal(stamp({ id: 'x', via }, env).agent, undefined, via);
  assert.equal(
    stamp({ id: 'x', via: 'undo' }, env, { person: true }).agent,
    undefined,
    'a dashboard undo'
  );
  assert.equal(
    stamp({ id: 'x', via: 'undo' }, env).agent,
    'claude-code',
    'a CLI-side undo under a marker'
  );
});

test('commands that need a person exit 3 and name the assistant', () => {
  const f = fixture({ withSigs: false });
  const env = { AI_AGENT: 'github_copilot_vscode_agent' };
  for (const args of [
    ['approve', 'apply'],
    ['approve', 'undo', 'x'],
    ['approve', 'verify', '--adopt'],
    ['serve', '--link'],
    ['serve', '--link', '--open'],
    ['serve', '--link', '--copy'],
    ['check', '--full', '--update'],
    ['doctor', '--repair', '--apply', '--prune'],
  ]) {
    const r = pxsig(args, env, f.repo);
    assert.equal(r.status, 3, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(
      r.stderr + r.stdout,
      /refused under copilot \(AI_AGENT=github_copilot_vscode_agent\)/,
      args.join(' ')
    );
  }
});

test('doctor shows the marker this shell carries, or none', () => {
  const f = fixture({ withSigs: false });
  assert.match(
    pxsig(['doctor', '--offline'], { GEMINI_CLI: '1' }, f.repo).stdout,
    /Running under:\*\* gemini-cli \(GEMINI_CLI=1\)/
  );
  assert.match(
    pxsig(['doctor', '--offline'], {}, f.repo).stdout,
    /Running under:\*\* no agent marker/
  );
  assert.equal(
    JSON.parse(pxsig(['doctor', '--offline', '--json'], { CURSOR_AGENT: '1' }, f.repo).stdout).agent
      .name,
    'cursor'
  );
});

// --- pxsig setup ---------------------------------------------------------------------------------

/**
 * Every file under `dir`, relative, with its bytes.
 * @param {string} dir
 */
const tree = (dir) => {
  /** @type {Record<string, string>} */
  const out = {};
  /** @param {string} d */
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).replace(/\\/g, '/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
};
const tmp = () => tempDir('setup');
/** @param {string[]} a */
const answers =
  (...a) =>
  async () =>
    a.shift() ?? '';

test('setup --print, CI and assistants: the recipe, no question, nothing written', async () => {
  for (const a of ASSISTANTS) {
    const root = tmp();
    const r = await setupCommand({
      flags: { assistant: a.id, print: true },
      root,
      person: true,
      ask: () => assert.fail('asked'),
    });
    assert.deepEqual(tree(root), {}, a.id);
    assert.deepEqual(r.data.wrote, []);
    const r2 = await setupCommand({
      flags: { assistant: a.id },
      root,
      person: false,
      ask: () => assert.fail('asked'),
    });
    assert.deepEqual(tree(root), {}, `${a.id}, not a person`);
    assert.equal(r2.data.print, true);
  }
  const list = await setupCommand({ root: tmp(), person: false });
  assert.deepEqual(
    // Without an assistant named, setup lists them.
    /** @type {{ id: string }[]} */ (list.data.assistants).map((x) => x.id),
    ASSISTANTS.map((x) => x.id)
  );
  const r = pxsig(['setup', '--assistant', 'vscode'], { CLAUDECODE: '1' }, tmp());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /printed only; nothing written/);
  assert.match(r.stdout, /\$\{workspaceFolder\}\/node_modules\/pxsig\/bin\/pxsig\.mjs/);
  assert.match(r.stdout, /never approve or accept pxsig baselines/);
  assert.equal(pxsig(['setup', '--assistant', 'nope']).status, 2);
  assert.equal(pxsig(['setup', 'forge']).status, 2);
});

test('setup writes each project file only on a yes, only when absent, and only in the repository', async () => {
  const root = tmp();
  /** @type {{ text?: string }[]} */
  const shown = [];
  // Asked: which assistant (3 = Claude Code), then one yes per absent file.
  const r = await setupCommand({
    root,
    person: true,
    ask: answers('3', 'y', 'yes'),
    show: (b) => shown.push(...b),
  });
  assert.equal(r.data.assistant, 'claude-code');
  assert.deepEqual(r.data.wrote.sort(), ['.mcp.json', 'CLAUDE.md']);
  assert.deepEqual(Object.keys(tree(root)).sort(), ['.mcp.json', 'CLAUDE.md']);
  assert.equal(tree(root)['CLAUDE.md'], SNIPPET);
  assert.deepEqual(JSON.parse(tree(root)['.mcp.json']), {
    mcpServers: { pxsig: { command: 'node', args: ['node_modules/pxsig/bin/pxsig.mjs', 'mcp'] } },
  });
  assert.ok(
    shown.some((b) => b.text?.includes('"mcpServers"')),
    'the recipe is shown before the questions'
  );

  // Again: both exist now, so nothing is asked and nothing changes.
  writeFileSync(join(root, 'CLAUDE.md'), '# Mine\n');
  const again = await setupCommand({
    root,
    person: true,
    flags: { assistant: 'claude-code' },
    ask: () => assert.fail('asked about an existing file'),
  });
  assert.deepEqual(again.data.wrote, []);
  assert.equal(
    readFileSync(join(root, 'CLAUDE.md'), 'utf8'),
    '# Mine\n',
    'an existing file is never edited'
  );
  // CLAUDE.md is one of claude-code's files.
  assert.match(
    /** @type {{ state: string }} */ (again.data.files.find((x) => x.file === 'CLAUDE.md')).state,
    /exists/
  );

  // A no writes nothing; a user-scope file (Windsurf) is never offered.
  const other = tmp();
  const no = await setupCommand({
    root: other,
    person: true,
    flags: { assistant: 'vscode' },
    ask: answers('n', ''),
  });
  assert.deepEqual(no.data.wrote, []);
  assert.deepEqual(tree(other), {});
  /** @type {string[]} */
  const asked = [];
  const ws = await setupCommand({
    root: other,
    person: true,
    flags: { assistant: 'windsurf' },
    ask: async (q) => (asked.push(q), 'y'),
  });
  assert.deepEqual(asked, ['Create AGENTS.md? [y/N] ']);
  assert.deepEqual(ws.data.wrote, ['AGENTS.md']);
  assert.deepEqual(Object.keys(tree(other)), ['AGENTS.md']);

  // A file in a subfolder: its folder is created inside the repository.
  const sub = tmp();
  mkdirSync(join(sub, '.github'));
  await setupCommand({
    root: sub,
    person: true,
    flags: { assistant: 'vscode' },
    ask: answers('y', 'y'),
  });
  assert.deepEqual(Object.keys(tree(sub)).sort(), [
    '.github/copilot-instructions.md',
    '.vscode/mcp.json',
  ]);

  // The assistant named after `setup`, as with --assistant; an unknown name or two names is usage.
  const same = tmp();
  const named = await setupCommand({ root: same, step: 'vscode', flags: { print: true } });
  const flagged = await setupCommand({ root: same, flags: { assistant: 'vscode', print: true } });
  assert.deepEqual(named.data, flagged.data);
  await assert.rejects(
    setupCommand({ root: tmp(), step: 'vscod', flags: { print: true } }),
    /unknown assistant "vscod": one of vscode/
  );
  await assert.rejects(
    setupCommand({ root: tmp(), step: 'vscode', flags: { assistant: 'cursor', print: true } }),
    /two assistants named/
  );

  // An answer that is not on the list writes nothing.
  await assert.rejects(
    setupCommand({ root: tmp(), person: true, ask: answers('99') }),
    /not one of/
  );
});

test('every recipe parses, starts the local install with node, and is in docs/agents.md word for word', () => {
  const doc = readFileSync(join(repo, 'docs', 'agents.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(doc.includes(SNIPPET), 'the instruction');
  for (const v of MARKER_VARS) assert.ok(doc.includes(`\`${v}`), `docs/agents.md: ${v}`);
  for (const a of ASSISTANTS) {
    const m = a.mcp('<repo>');
    if (!m) continue;
    assert.ok(doc.includes(m.text), `docs/agents.md: the ${a.id} recipe`);
    assert.ok(m.text.includes('node_modules/pxsig/bin/pxsig.mjs'), a.id);
    assert.ok(!/npx|\.cmd\b/.test(m.text), `${a.id}: no npx, no shim`);
    if (m.lang === 'json') {
      const j = JSON.parse(m.text);
      const entry = (j.servers ?? j.mcpServers ?? j.context_servers).pxsig;
      assert.equal(entry.command, 'node', a.id);
      assert.equal(entry.args.at(-1), 'mcp', a.id);
    }
    if (m.lang === 'toml')
      for (const l of m.text.trim().split('\n'))
        assert.match(l, /^\[[\w.]+\]$|^\w+ = (".*"|\[.*\])$/, `${a.id}: ${l}`);
    if (m.lang === 'yaml')
      for (const l of m.text.trim().split('\n'))
        assert.match(l, /^( {2})*(- )?[\w./-]+(: ?.*)?$/, `${a.id}: ${l}`);
  }
});
