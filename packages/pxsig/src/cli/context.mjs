/**
 * cli/context.mjs — the per-run state and helpers every `pxsig` command shares (cli.mjs builds it
 * once from the parsed arguments): the current project, the in-process tool runner and the
 * multi-project read loop.
 */
import { ctxOf, tools } from '../tools/index.mjs';
import { findWorkspace, pickProject } from '../lib/workspace.mjs';
import { emit } from '../lib/term.mjs';
import { combineExits } from '../lib/enforcement.mjs';

/** @import { Flags } from '../types.js' */
/** @import { Block, Format, Rendered, StyledCell, ToolInput, ToolName, ToolOutput } from '../types/t6.js' */

/**
 * Build the context from cli.mjs's parsed arguments: `project` is --project (or PXSIG_PROJECT),
 * `here` is src/, and `CMD` is the name the CLI is run as.
 * @param {{ flags: Flags, positional: string[], format: Format, command: string, rest: string[], CMD: string, here: string, project: string | undefined }} opts
 */
export function cliContext({ flags, positional, format, command, rest, CMD, here, project }) {
  /** The project a call is about: `name` in a multi-project loop, else --project / the current folder. */
  let current = project;
  /**
   * Run the MCP tool `pxsig_<name>` in-process, on the current project.
   * @template {ToolName} N
   * @param {N} name
   * @param {Partial<NonNullable<ToolInput<N>>>} [args]
   * @returns {Promise<ToolOutput<N>>}
   */
  const run = (name, args = {}) =>
    // `pxsig_${name}` is one of the tools: ToolOutput<N> is what its run resolves with.
    /** @type {Promise<ToolOutput<N>>} */ (
      /** @type {{ run: (args: object) => Promise<unknown> }} */ (
        tools.find((t) => t.name === `pxsig_${name}`)
      )
        .run({ ...(current ? { project: current } : {}), ...args })
        .catch((/** @type {Error & { cli?: string }} */ e) => {
          // A tool's error worded for the CLI, when it has one (tools/context.mjs `noReport`).
          if (e.cli) e.message = e.cli;
          throw e;
        })
    );
  /** @typedef {ReturnType<typeof ctxOf>} ProjectContext */
  /** @type {Map<string, ProjectContext>} */
  const ctxCache = new Map();
  /** @returns {ProjectContext} */
  const ctx = () => {
    const k = current ?? '';
    if (!ctxCache.has(k)) ctxCache.set(k, ctxOf(current));
    // Set just above when it was missing.
    return /** @type {ProjectContext} */ (ctxCache.get(k));
  };
  /**
   * A comma-separated flag's values; none for a bare flag or none given.
   * @param {unknown} v
   * @returns {string[]}
   */
  const list = (v) =>
    typeof v === 'string'
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  /** @param {string} id */
  const inspectUrl = (id) => {
    const C = ctx();
    return `${C.serverUrl}/report/?project=${encodeURIComponent(C.P.name)}#inspect=${encodeURIComponent(id)}`;
  };
  /**
   * @param {string} id
   * @returns {StyledCell}
   */
  const idCell = (id) => ({ text: id, url: inspectUrl(id), noLinkInPlain: true });
  /** @param {number | null | undefined} n */
  const pct = (n) => (n == null ? '' : `${n}%`);
  /** @type {(msg: string, code?: number) => never} */
  const fail = (msg, code = 2) => {
    if (format === 'json') process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`pxsig: ${msg}\n`);
    process.exit(code);
  };
  /**
   * A flag that takes a value, given bare (`--component` alone is `true`), is a usage error.
   * @param {string[]} names
   */
  const needValues = (names) => {
    for (const n of names) if (flags[n] === true) fail(`usage: --${n} needs a value`);
  };

  /**
   * The projects a read command covers: --project, else every project with --all, else the project
   * holding the current folder, else every project.
   * @returns {string[]}
   */
  function readTargets() {
    if (project) return [project];
    const ws = findWorkspace({});
    if (flags.all) return ws.projects.map((p) => p.name);
    const ref = pickProject(ws, { cwd: process.cwd() });
    return ref ? [ref.name] : ws.projects.map((p) => p.name);
  }

  /**
   * Tag a project's blocks: a heading, and a Project column in front of every table.
   * @param {string} name
   * @param {Block[]} blocks
   * @returns {Block[]}
   */
  function forProject(name, blocks) {
    /** @type {Block[]} */
    const out = [];
    for (const b of blocks) {
      if (b?.h && out.length === 0) out.push({ ...b, h: `${b.h} · ${name}` });
      else if (b?.table)
        out.push({
          table: {
            ...b.table,
            cols: [{ key: '_project', label: 'Project' }, ...b.table.cols],
            rows: b.table.rows.map((r) => ({ _project: name, ...r })),
          },
        });
      else if (b?.list)
        out.push({
          // A list item is text or a styled cell.
          list: b.list.map((x) =>
            typeof x === 'string'
              ? `${name}: ${x}`
              : {
                  .../** @type {StyledCell} */ (x),
                  text: `${name}: ${/** @type {StyledCell} */ (x).text}`,
                }
          ),
        });
      else out.push(b);
    }
    return out;
  }

  /**
   * Run a read command's renderer for each target project. A renderer returns { blocks, data, exit }.
   * One project: printed as before. Several: one document, each project's rows tagged with its name,
   * JSON as { projects: [{ project, …data }] }, and the worst exit code.
   * @param {() => Promise<Rendered>} render
   * @param {string[]} [names]
   */
  async function overProjects(render, names = readTargets()) {
    if (names.length === 1) {
      current = names[0];
      const r = await render();
      emit(format, r.blocks, r.data);
      process.exit(r.exit ?? 0);
    }
    /** @type {Block[]} */
    const blocks = [];
    /** @type {object[]} */
    const data = [];
    /** @type {{ exit: number, advisory?: boolean }[]} */
    const exits = [];
    for (const name of names) {
      current = name;
      try {
        const r = await render();
        blocks.push(...forProject(name, r.blocks));
        data.push({ project: name, ...r.data });
        exits.push({ exit: r.exit ?? 0, advisory: !!r.advisory });
      } catch (e) {
        blocks.push({ h: name }, { note: /** @type {Error} */ (e).message, tone: 'bad' });
        data.push({ project: name, error: /** @type {Error} */ (e).message });
        exits.push({ exit: 2 });
      }
    }
    emit(format, blocks, { projects: data });
    // The worst code wins; an advisory exit (warn mode) never hides another project's failure.
    process.exit(combineExits(exits));
  }

  /**
   * Write commands need exactly one project.
   * @returns {string}
   */
  function oneProject() {
    if (project) return project;
    const ws = findWorkspace({});
    const ref = pickProject(ws, { cwd: process.cwd() });
    if (!ref)
      fail(
        `this workspace has ${ws.projects.length} projects; "${command}" changes one: choose it with --project (${ws.projects.map((p) => p.name).join(', ')})`
      );
    return ref.name;
  }
  return {
    flags,
    positional,
    format,
    command,
    rest,
    CMD,
    here,
    project,
    get current() {
      return current;
    },
    /** @param {string | undefined} v */
    set current(v) {
      current = v;
    },
    run,
    ctx,
    list,
    inspectUrl,
    idCell,
    pct,
    fail,
    needValues,
    readTargets,
    forProject,
    overProjects,
    oneProject,
  };
}

/** @typedef {ReturnType<typeof cliContext>} CliContext */
