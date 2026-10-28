/**
 * setup.mjs — `pxsig setup`: the assistant step (decisions 9.6, 80, 93).
 *
 *   pxsig setup [<assistant>|assistant] [--assistant <name>] [--print]
 *
 * The word after `setup` is an assistant's name (`pxsig setup vscode`, as `--assistant vscode`) or
 * the step's name, `assistant`, which is the only step in this version.
 *
 * Asks which coding assistant is used here (a numbered list; a person at a terminal only), then
 * prints its recipe: the MCP file, the entry that starts pxsig's MCP server with the local install,
 * the policy that can turn it off on a managed machine, and the instruction for the assistant. It
 * then offers to create the repository's MCP file and instruction file, each on a typed yes and only
 * when the file does not exist. An existing file is never edited: the block to add is printed.
 *
 * Never: a file in the home folder or another tool's settings (printed only), another tool's CLI, a
 * check of which assistants are installed. `--print`, CI and assistants get the recipe and no
 * question; nothing is written.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ASSISTANTS, assistant, SCRIPT } from './lib/assistants.mjs';
import { findWorkspace } from './lib/workspace.mjs';
import { toPosix } from './lib/paths.mjs';

/** @import { Assistant } from './types.js' */
/** @import { Block, SetupFile } from './types/t6.js' */

const STEPS = ['assistant'];

/**
 * The repository the recipes point at: the workspace root, else the current folder.
 * @param {string} [cwd]
 * @returns {string}
 */
export function setupRoot(cwd = process.cwd()) {
  try {
    return findWorkspace({ cwd }).root;
  } catch {
    return cwd;
  }
}

/**
 * Run the step. `person`: a person at a terminal (questions allowed); `ask(question)` resolves with
 * the typed line; `show(blocks)` prints the recipe before the questions about writing it. Returns
 * `{ blocks, data, exit }` (the blocks still to print); throws `{ exit: 2 }` errors for bad usage.
 */
/**
 * @param {{ step?: string | null, flags?: import('./types.js').Flags, root?: string,
 *   person?: boolean, ask?: ((q: string) => Promise<string>) | null,
 *   show?: ((blocks: Block[]) => void) | null, CMD?: string }} opts
 */
export async function setupCommand({
  step = null,
  flags = {},
  root = setupRoot(),
  person = false,
  ask = null,
  show = null,
  CMD = 'pxsig',
}) {
  /** @param {string} m */
  const usage = (m) => Object.assign(new Error(m), { exit: 2 });
  const named = step && !STEPS.includes(step) ? step : null;
  if (named && !assistant(named))
    throw usage(
      `unknown assistant "${named}": one of ${ASSISTANTS.map((a) => a.id).join(', ')} (or the step: assistant)`
    );
  if (named && typeof flags.assistant === 'string' && flags.assistant !== named)
    throw usage(`two assistants named: "${named}" and --assistant ${flags.assistant}`);
  const print = Boolean(flags.print) || !person;
  let id = typeof flags.assistant === 'string' ? flags.assistant : named;
  if (id && !assistant(id))
    throw usage(`unknown assistant "${id}": one of ${ASSISTANTS.map((a) => a.id).join(', ')}`);

  if (!id && print) {
    // No questions without a person: the list, and the command that prints one recipe.
    return {
      blocks: [
        { h: 'pxsig setup', sub: 'which coding assistant is used here' },
        {
          table: {
            cols: [
              { key: 'id', label: '--assistant' },
              { key: 'label', label: 'Assistant' },
            ],
            rows: ASSISTANTS.map((a) => ({ id: a.id, label: a.label })),
          },
        },
        { next: [[`${CMD} setup --assistant <name> --print`, 'its recipe; writes nothing']] },
      ],
      data: { assistants: ASSISTANTS.map((a) => ({ id: a.id, label: a.label })) },
      exit: 0,
    };
  }
  if (!id) {
    const lines = ASSISTANTS.map((a, i) => `  ${String(i + 1).padStart(2)}. ${a.label}`).join('\n');
    // Only a person gets here (`print` is set otherwise), and the CLI passes `ask` with one.
    const answer = await /** @type {(q: string) => Promise<string>} */ (ask)(
      `Which coding assistant is used here?\n${lines}\nType 1–${ASSISTANTS.length}: `
    );
    const n = Number(answer);
    if (!Number.isInteger(n) || n < 1 || n > ASSISTANTS.length)
      throw usage(`not one of 1–${ASSISTANTS.length}: "${answer}"; nothing was written`);
    id = ASSISTANTS[n - 1].id;
  }

  // `id` is a known assistant: a named one was checked above, a typed number picked from the list.
  const a = /** @type {Assistant} */ (assistant(id));
  const repo = toPosix(root);
  const mcp = a.mcp(repo);
  /** @type {SetupFile[]} */
  const files = [];
  if (mcp)
    // Each file's state is set in the loop below, before anything reads it.
    files.push(
      /** @type {SetupFile} */ ({
        role: 'mcp',
        file: mcp.file,
        scope: mcp.scope,
        lang: mcp.lang,
        text: mcp.text,
      })
    );
  if (a.instructions)
    files.push(
      /** @type {SetupFile} */ ({
        role: 'instructions',
        file: a.instructions.file,
        scope: 'project',
        lang: 'text',
        text: a.instructions.text,
      })
    );

  /** @type {Block[]} */
  const blocks = [
    {
      h: `pxsig setup · ${a.label}`,
      sub: print
        ? 'printed only; nothing written'
        : 'each file only on a yes, and only when it does not exist',
    },
  ];
  if (!files.length) blocks.push({ note: 'Nothing to set up for an assistant.', tone: 'ok' });
  if (files.length && !existsSync(join(root, SCRIPT)))
    blocks.push({
      note: `pxsig is not installed in ${repo}/node_modules: add it as a dev dependency of the repository root, or the server will not start.`,
      tone: 'warn',
    });

  for (const f of files) {
    const path = f.scope === 'project' ? join(root, f.file) : null;
    f.state =
      f.scope === 'user'
        ? 'home folder: add by hand'
        : // a project file: `path` is set
          existsSync(/** @type {string} */ (path))
          ? 'exists: add the block by hand'
          : 'absent';
    blocks.push({
      h: f.role === 'mcp' ? `MCP server · ${f.file}` : `Instruction for the assistant · ${f.file}`,
    });
    blocks.push({ text: '```' + (f.lang === 'text' ? '' : f.lang) + '\n' + f.text + '```' });
  }
  if (a.policy) blocks.push({ kv: [['Managed machines', a.policy]] });
  if (a.notes.length) blocks.push({ list: a.notes });

  /** @type {string[]} */
  const wrote = [];
  const asking = !print && files.some((f) => f.state === 'absent');
  if (asking && show) show(blocks.splice(0));
  for (const f of files) {
    if (print || f.state !== 'absent') continue;
    // `asking` needs a person (`!print`), who comes with `ask`.
    const yes = /^y(es)?$/i.test(
      await /** @type {(q: string) => Promise<string>} */ (ask)(`Create ${f.file}? [y/N] `)
    );
    if (!yes) {
      f.state = 'declined';
      continue;
    }
    const path = join(root, f.file);
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, f.text, { flag: 'wx' }); // never over a file that appeared meanwhile
      f.state = 'written';
      wrote.push(f.file);
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
      f.state = 'exists: add the block by hand';
    }
  }
  if (!print && files.length) blocks.push({ kv: files.map((f) => [f.file, f.state]) });
  blocks.push({
    next: [
      [`${CMD} help agents`, 'what pxsig does under an assistant'],
      [`${CMD} doctor`, 'shows the assistant marker this shell carries, if any'],
    ],
  });
  return {
    blocks,
    data: {
      assistant: a.id,
      root: repo,
      print,
      files: files.map(({ role, file, scope, lang, text, state }) => ({
        role,
        file,
        scope,
        lang,
        text,
        state,
      })),
      policy: a.policy,
      notes: a.notes,
      wrote,
    },
    exit: 0,
  };
}
