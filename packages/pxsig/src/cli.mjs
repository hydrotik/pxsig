#!/usr/bin/env node
/**
 * cli.mjs — `pxsig`: the harness from a shell, for people and for agents.
 *
 *   pxsig [command] [args] [--project name | --all] [--workspace dir] [--json | --plain | --markdown | --pretty]
 *         [--storybook-url u] [--storybook-static dir] [--grid n] [--browser ws://…]   (config flags: the top layer)
 *
 *   projects                    the projects in this workspace, with their store and integrity
 *   init [dir] [--name x] [--src src] [--storybook-url url] [--storybook-config dir] [--layout colocated]
 *                               set a package up: pxsig.config.json, its store, the workspace entry
 *                               (colocated: also `*.psig binary diff=psig` in the root .gitattributes)
 *   config                      the resolved config of a project, and which layer set each key
 *   setup [assistant] [--assistant name] [--print]
 *                               the coding assistant's recipe: its MCP entry (the local install, no npx) and
 *                               the instruction not to approve; creates those files only on a yes, only when absent
 *   manifest [--suite x]        rebuild the project's entries from the running Storybook
 *   serve [--watch] [--port n]  the server and dashboard, for every project
 *   mcp                         the MCP server (stdio)
 *   report [--out dir]          a static dashboard for one project
 *   dashboard build [--ui path] [--out dir]
 *                               rebuild the dashboard on this project's design system through a UI adapter
 *                               (--ui, else dashboard.ui in pxsig.config.json; docs/ui/build-adapter.md)
 *   dashboard gaps [--ui path]  what that adapter covers of the UI contract, and what it does not
 *   browser start [--image tag] [--port 3000] | stop | status
 *                               Playwright's browser in the pxsig container image, for --browser <ws>
 *                               (the only commands that start docker; docs/container.md)
 *   cat <file.psig> [--image out.png]
 *                               a baseline's header (git's textconv for *.psig), or its image
 *   migrate --from <dir> [--apply] [--no-verify]
 *                               move a pre-0.2 store (.baselines + .renders/base) into this project
 *
 *   status                      overview: counts, a11y, most-changed components, server, staleness (default)
 *   stale                       results older than the edits that can change them
 *   list [state] [--component x] [--mode dark] [--limit 30]
 *                               entries by state (problems | changed | error | flaky | drift | pass | a11y | all)
 *   entry <id> [--images baseline,current,diff]
 *                               one entry: verdict, metrics, regions, a11y, and its images
 *   check [ids…] [--changed a.tsx,b.css.ts] [--since main] [--all]
 *                               re-render and re-check (server if up, else in-process); never writes baselines
 *   check --full [--suite x] [--modes a,b] [--update] …
 *                               the full check (src/check.mjs); --update writes baselines (a person only)
 *   affected <files…> | --since <ref>
 *                               which entries those edits can change
 *   a11y [--component x] [--new] [--sarif out.sarif]
 *                               axe violations per entry (--sarif: the new ones as SARIF 2.1.0)
 *   a11y --prune --dry-run [--component x] [--mode m] [--only id,…]
 *                               accepted axe rules a fresh check shows no longer fire (prunable), and why
 *                               the others are not: still fires, stale, not covered
 *   a11y --prune [same filters] [--reason "…"]
 *                               remove the prunable ones (a person at a terminal; typed confirmation)
 *   history [--limit 10]        the last runs
 *   doctor [--component x] [--status code,…] [--ci] [--fail-on error|warn|info] [--offline] [--limit 40]
 *                               integrity per component: unregistered stories, never-checked entries, missing
 *                               baseline images / renders, render errors, stale verdicts, orphans (docs/integrity.md)
 *   doctor --repair [--only register,recheck,restore-baseline-image,convert-legacy] [--apply] [--prune] [--stale]
 *                               the safe repairs: a dry-run plan, or with --apply run them. Never changes a
 *                               signature or approves; --prune (a person at a terminal) moves orphans to trash/;
 *                               --stale also re-checks stale verdicts (left out by default)
 *   approve plan|apply|log|undo|verify
 *                               the guarded bulk approval (src/approve.mjs): plan classifies colour vs shape
 *                               changes and pins render hashes (--new: first baselines); apply is for a
 *                               person at a terminal only
 *
 * Projects: read commands (status, list, stale, a11y, history, doctor) run over every project with
 * --all, and by default when the workspace has several and none is chosen (by --project or the
 * current folder); their rows then carry the project. Every other command needs one project.
 * --workspace (or PXSIG_WORKSPACE) picks the workspace for every command and what they start.
 *
 * Same answers as the MCP server (it runs the same tool code in-process), rendered by lib/term.mjs:
 * a styled terminal view on a TTY, Markdown when piped (Claude Code, Codex, CI), JSON with --json.
 * Exit: 0 ok · 1 problems found (check / stale / doctor) · 2 usage or setup error · 3 needs a person at a terminal.
 * Over several projects, the worst exit wins.
 * Warn mode (lib/enforcement.mjs): `check`, `doctor`, `stale` and `approve verify` take
 * `--enforce[=gate,…]` (anyone) and `--warn[=gate,…]` (a person at a terminal); a gate the committed
 * config sets to warn exits `advisoryExit` (0) where it alone would have failed, and says so. A real
 * failure in another project still beats an advisory exit.
 * Per-entry approve / reject stays in the dashboard and Storybook panel, where a person sees the images.
 */
import { spawn, spawnSync } from './lib/spawn.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approveCommand } from './approve.mjs';
import { helpBlocks, helpData, lookup, nearestNames } from './help.mjs';
import { ctxOf, doctor, imageOf, prunePlan, tools } from './mcp.mjs';
import { parseArgs } from './lib/args.mjs';
import { CODES } from './lib/integrity.mjs';
import { describeLock, readLock, takeLock } from './lib/lock.mjs';
import { buildManifest, describeConfig, initProject, migrateLegacy } from './lib/setup.mjs';
import { findWorkspace, flagLayer, openProject, pickProject, rustBinary, serverUrlFor, setFlagLayer } from './lib/workspace.mjs';
import { readToken, TOKEN_HEADER } from './lib/guard.mjs';
import { ask, emit, humanAtTerminal, pickFormat, progress, stateCell, whyNotPerson } from './lib/term.mjs';
import { relPath } from './lib/paths.mjs';
import { applyPrune, confirmPrune } from './lib/prune.mjs';
import { newBatch } from './lib/approvals.mjs';
import { describeAgent } from './lib/agents.mjs';
import { appendReadiness, combineExits, describeEnforcement, lastLine, leadLine, outcome, readinessTally, reportBlock, resolveEnforcement, resolveOrExit } from './lib/enforcement.mjs';
import { writeSarif } from './lib/sarif.mjs';

// --- args --------------------------------------------------------------------------------------
const { positional, flags } = parseArgs(process.argv.slice(2));
const format = pickFormat(flags);
const [command = 'status', ...rest] = positional;
const CMD = process.env.PXSIG_CMD ?? 'pxsig';
const here = dirname(fileURLToPath(import.meta.url));
// --workspace applies to everything: this process, the tools it calls and the commands it starts.
if (typeof flags.workspace === 'string') process.env.PXSIG_WORKSPACE = resolve(flags.workspace);
// Config flags (--storybook-url, --grid, …) are the top config layer for every project opened here.
setFlagLayer(flagLayer(flags));
const project = typeof flags.project === 'string' ? flags.project : (process.env.PXSIG_PROJECT ?? undefined);
/** The project a call is about: `name` in a multi-project loop, else --project / the current folder. */
let current = project;
const run = (name, args = {}) => tools.find((t) => t.name === `pxsig_${name}`).run({ ...(current ? { project: current } : {}), ...args });
const ctxCache = new Map();
const ctx = () => {
  const k = current ?? '';
  if (!ctxCache.has(k)) ctxCache.set(k, ctxOf(current));
  return ctxCache.get(k);
};
const list = (v) =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
const inspectUrl = (id) => {
  const C = ctx();
  return `${C.serverUrl}/report/?project=${encodeURIComponent(C.P.name)}#inspect=${encodeURIComponent(id)}`;
};
const idCell = (id) => ({ text: id, url: inspectUrl(id), noLinkInPlain: true });
const pct = (n) => (n == null ? '' : `${n}%`);
const fail = (msg, code = 2) => {
  if (format === 'json') process.stdout.write(JSON.stringify({ error: msg }) + '\n');
  else process.stderr.write(`pxsig: ${msg}\n`);
  process.exit(code);
};

/**
 * The projects a read command covers: --project, else every project with --all, else the project
 * holding the current folder, else every project.
 */
function readTargets() {
  if (project) return [project];
  const ws = findWorkspace({});
  if (flags.all) return ws.projects.map((p) => p.name);
  const ref = pickProject(ws, { cwd: process.cwd() });
  return ref ? [ref.name] : ws.projects.map((p) => p.name);
}

/** Tag a project's blocks: a heading, and a Project column in front of every table. */
function forProject(name, blocks) {
  const out = [];
  for (const b of blocks) {
    if (b?.h && out.length === 0) out.push({ ...b, h: `${b.h} · ${name}` });
    else if (b?.table) out.push({ table: { ...b.table, cols: [{ key: '_project', label: 'Project' }, ...b.table.cols], rows: b.table.rows.map((r) => ({ _project: name, ...r })) } });
    else if (b?.list) out.push({ list: b.list.map((x) => (typeof x === 'string' ? `${name}: ${x}` : { ...x, text: `${name}: ${x.text}` })) });
    else out.push(b);
  }
  return out;
}

/**
 * Run a read command's renderer for each target project. A renderer returns { blocks, data, exit }.
 * One project: printed as before. Several: one document, each project's rows tagged with its name,
 * JSON as { projects: [{ project, …data }] }, and the worst exit code.
 */
async function overProjects(render, names = readTargets()) {
  if (names.length === 1) {
    current = names[0];
    const r = await render();
    emit(format, r.blocks, r.data);
    process.exit(r.exit ?? 0);
  }
  const blocks = [];
  const data = [];
  const exits = [];
  for (const name of names) {
    current = name;
    try {
      const r = await render();
      blocks.push(...forProject(name, r.blocks));
      data.push({ project: name, ...r.data });
      exits.push({ exit: r.exit ?? 0, advisory: !!r.advisory });
    } catch (e) {
      blocks.push({ h: name }, { note: e.message, tone: 'bad' });
      data.push({ project: name, error: e.message });
      exits.push({ exit: 2 });
    }
  }
  emit(format, blocks, { projects: data });
  // The worst code wins; an advisory exit (warn mode) never hides another project's failure.
  process.exit(combineExits(exits));
}

/** Write commands need exactly one project. */
function oneProject() {
  if (project) return project;
  const ws = findWorkspace({});
  const ref = pickProject(ws, { cwd: process.cwd() });
  if (!ref) fail(`this workspace has ${ws.projects.length} projects; "${command}" changes one: choose it with --project (${ws.projects.map((p) => p.name).join(', ')})`);
  return ref.name;
}

/**
 * Warn mode for a gated command (lib/enforcement.mjs): `found` is what each gate would fail on.
 * Returns the exit, the ADVISORY lead and last lines as blocks to put around the output, and the
 * `enforcement` data, and appends the readiness line when a gate is on warn by config.
 */
function gate(found, source, counts = {}) {
  const P = ctx().P;
  const enf = resolveOrExit(P, { flags }, (m, code) => fail(m, code));
  const out = outcome(enf, found);
  appendReadiness(P, enf, out, { source, counts });
  const lead = leadLine(enf);
  const last = lastLine(enf, out, enf.configured.length ? readinessTally(P) : null);
  const block = reportBlock(enf, out);
  return {
    exit: out.exit,
    advisory: out.advisory,
    lead: lead ? [{ note: lead, tone: 'warn' }] : [],
    last: last ? [{ note: last, tone: out.advisory ? 'warn' : undefined }] : [],
    data: block ? { enforcement: block } : {},
  };
}

/**
 * `pxsig a11y --prune [--dry-run]` (lib/prune.mjs, PHASE-1 §5): the dry run is for anyone, agents
 * included, and always exits 0; removing rules is a person's, at a terminal, after typing the
 * count. Through the server when it holds the store, so the dashboard updates; else under the lock.
 */
async function a11yPrune() {
  current = oneProject();
  const dry = !!flags['dry-run'];
  if (!dry && !humanAtTerminal())
    fail(`a11y --prune changes the accepted lists: run it yourself in a terminal (${whyNotPerson()}); \`${CMD} a11y --prune --dry-run\` lists what it would remove`, 3);
  const spin = progress(format, 'classifying accepted rules');
  let plan;
  try {
    plan = await prunePlan({ project: current, component: typeof flags.component === 'string' ? flags.component : undefined, mode: typeof flags.mode === 'string' ? flags.mode : undefined, only: list(flags.only), cmd: CMD });
  } catch (e) {
    spin.done(e.message, false);
    fail(e.message, 2);
  }
  const c = plan.counts;
  const n = c.prunable;
  spin.done(`${n} prunable of ${plan.items.length} accepted rules`);
  const blocks = [
    { h: dry ? 'Accessibility prune (dry run)' : 'Accessibility prune', sub: `${plan.items.length} accepted rules on ${plan.entries} entries` },
    {
      kv: [
        ['Prunable', { text: `${n} rules on ${plan.prune.length} entries`, color: n ? 'green' : 'gray' }],
        ['Still fires', String(c['still-fires'])],
        ['Stale', { text: String(c.stale), color: c.stale ? 'yellow' : 'gray' }],
        ['Not covered', { text: String(c['not-covered']), color: c['not-covered'] ? 'yellow' : 'gray' }],
        ['Reports', plan.reports.map((r) => `${r.file} (${r.rows} rows)`).join(', ') || 'none'],
      ],
    },
  ];
  if (plan.prune.length)
    blocks.push({
      table: {
        cols: [
          { key: 'id', label: 'Entry' },
          { key: 'rules', label: 'Rules no longer firing' },
          { key: 'at', label: 'Checked' },
        ],
        rows: plan.prune.slice(0, 60).map((p) => ({ id: p.id, rules: p.rules.join(', '), at: p.evidence.checkedAt?.replace('T', ' ').slice(0, 19) ?? '' })),
        more: Math.max(0, plan.prune.length - 60),
        moreHint: 'every rule, with why, in --json',
      },
    });
  const next = plan.cover.map((x) => [x.command, `${x.entries} entries ${x.class === 'stale' ? 'checked before a later edit or decision' : 'with no row where axe ran'}: check them, then prune again`]);
  if (dry || !n) {
    if (!n) blocks.push({ note: 'Nothing to prune.', tone: 'ok' });
    if (dry && n) next.unshift([`${CMD} a11y --prune`, `a person, in a terminal: remove the ${n} prunable rules`]);
    blocks.push({ next });
    emit(format, blocks, plan);
    process.exit(0);
  }
  emit(format, blocks, plan);
  if (!(await confirmPrune(plan, ask))) fail('not confirmed: nothing was written', 1);
  const reason = typeof flags.reason === 'string' ? flags.reason.trim().slice(0, 500) || null : null;
  const batch = newBatch('prune');
  const P = ctx().P;
  const held = readLock(P);
  let r;
  if (held && !held.stale && held.holder === 'serve' && !held.foreign) {
    // The server holds the store: it writes, and the dashboard hears of it.
    const url = held.url ?? ctx().serverUrl;
    const token = readToken(P.workspaceRoot, url);
    if (!token) fail(`no token from the pxsig server at ${url} (it writes one when it starts): restart \`${CMD} serve\` with this version`);
    const res = await fetch(`${url}/__pxsig/a11y-prune`, { method: 'POST', headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token }, body: JSON.stringify({ project: P.name, plan: { a11ySha: plan.a11ySha, prune: plan.prune }, batch, reason }) }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) fail(`the server refused the prune: ${body.error ?? `HTTP ${res.status}`}`, res.status === 409 ? 1 : 2);
    r = body;
  } else {
    let lock;
    let err = null;
    try {
      lock = await takeLock(P, { holder: 'a11y --prune' });
      r = applyPrune(P, plan, { batch, reason, via: 'cli', lockCheck: () => lock.check() });
    } catch (e) {
      err = e;
    } finally {
      lock?.release();
    }
    // A plan made stale by a decision since is refused whole: plan again (exit 1, as a wrong phrase).
    if (err) fail(err.message, err.exit ?? (err.status === 409 ? 1 : 2));
  }
  emit(
    format,
    [
      { h: 'Pruned', sub: `${r.rules} rules from ${r.entries} entries` },
      { kv: [['Batch', batch], ['Log', relPath(process.cwd(), join(dirname(P.store.a11y), 'a11y-decisions.ndjson'))]] },
      { next: [[`${CMD} a11y`, 'the violations, against the shorter lists'], ...next] },
    ],
    { batch, entries: r.entries, rules: r.rules }
  );
}

/** The entries table every listing shares. */
function entryTable(entries, { more = 0 } = {}) {
  return {
    table: {
      cols: [
        { key: 'state', label: 'State' },
        { key: 'id', label: 'Entry' },
        { key: 'ssim', label: 'SSIM', right: true },
        { key: 'cells', label: 'Cells', right: true },
        { key: 'why', label: 'Why' },
      ],
      moreHint: 'raise --limit',
      rows: entries.map((e) => ({
        state: stateCell(e.state),
        id: idCell(e.id),
        ssim: e.ssim ?? '',
        cells: pct(e.changedCellsPct),
        why: e.error ?? (e.reasons ?? [])[0] ?? '',
      })),
      more,
    },
  };
}

/** One project's doctor: reconcile (and plan or apply repairs), as blocks. */
async function doctorOne({ repair, only, failOn }) {

    const spin = progress(format, repair === 'apply' ? 'repairing' : 'reconciling');
    let r;
    let lock = null;
    let viaServer = null;
    if (repair === 'apply') {
      const P = ctx().P;
      const held = readLock(P);
      if (held && !held.stale && held.holder === 'serve' && !held.foreign) {
        if (flags.prune) fail(`${describeLock(P, held)}: --prune moves files, so it cannot run beside the server; stop it first`);
        if (only.includes('log-torn')) fail(`${describeLock(P, held)}: the server appends to the approval log, so --only log-torn cannot run beside it; stop it first`);
        viaServer = held.url ?? ctx().serverUrl;
      } else
        try {
          lock = await takeLock(P, { holder: 'doctor --repair' });
          lock.check();
        } catch (e) {
          spin.done(e.message, false);
          fail(e.message, e.exit ?? 2);
        }
    }
    try {
      if (viaServer) {
        // The server holds the store: its queue runs the repairs; then reconcile here to report.
        const res = await fetch(`${viaServer}/__pxsig/repair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: current, apply: true, only: only.length ? only : undefined, stale: !!flags.stale }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `the server refused the repair (HTTP ${res.status})`);
        r = { ...(await doctor({ project: current, component: typeof flags.component === 'string' ? flags.component : undefined, status: typeof flags.status === 'string' ? flags.status : undefined, limit: Number(flags.limit) || 40, offline: !!flags.offline })), plan: body.plan, applied: body.applied };
      } else
      r = await doctor({
        project: current,
        component: typeof flags.component === 'string' ? flags.component : undefined,
        status: typeof flags.status === 'string' ? flags.status : undefined,
        limit: Number(flags.limit) || 40,
        repair,
        only: only.length ? only : undefined,
        offline: !!flags.offline,
        stale: !!flags.stale,
        via: 'cli',
        prune: !!flags.prune,
        confirmPrune: flags.prune
          ? async (n) => {
              const phrase = `PRUNE ${n} ORPHANS`;
              return (await ask(`Move ${n} orphaned entries' files to the store trash// (nothing is deleted). Type "${phrase}" to continue: `)) === phrase;
            }
          : null,
        confirmTorn: only.includes('log-torn')
          ? async (n) => {
              const phrase = `REMOVE ${n} TORN LINES`;
              return (await ask(`Remove ${n} approval-log line(s) a crash cut short (every complete line is kept). Type "${phrase}" to continue: `)) === phrase;
            }
          : null,
      });
    } catch (e) {
      spin.done(e.message, false);
      fail(e.message, 2);
    } finally {
      lock?.release();
    }
    const sm = r.summary;
    spin.done(sm.headline, sm.status !== 'attention');
    const ix = r.sources.storyIndex;
    const sevCell = (code, severity) => ({
      text: `${severity === 'error' ? '✗' : severity === 'warn' ? '◆' : code === 'ok' ? '✓' : '·'} ${code}`,
      color: severity === 'error' ? 'red' : severity === 'warn' ? 'yellow' : code === 'ok' ? 'green' : 'gray',
    });
    const issueText = (counts) =>
      Object.entries(counts)
        .sort((a, b) => CODES[a[0]].rank - CODES[b[0]].rank)
        .map(([c, n]) => `${n} ${c}`)
        .join(', ');
    const blocks = [
      {
        h: 'pxsig doctor',
        sub: `${sm.components} components · ${sm.entries} entries · index: ${ix.source === 'storybook' ? 'Storybook (live)' : `static scan (${ix.reachable ? 'Storybook index broken' : 'Storybook not reachable'})`} · ${ix.inScope} stories in scope`,
      },
      { note: sm.headline, tone: sm.status === 'attention' ? 'bad' : sm.status === 'warnings' ? 'warn' : 'ok' },
      ...r.setup.map((x) => ({ note: `setup: ${x.code} — ${x.reason}`, tone: x.severity === 'error' ? 'bad' : 'warn' })),
      {
        kv: [
          ['Entries', [{ text: `${sm.bySeverity.error} error`, color: sm.bySeverity.error ? 'red' : 'gray' }, { text: `${sm.bySeverity.warn} warn`, color: sm.bySeverity.warn ? 'yellow' : 'gray' }, { text: `${sm.bySeverity.info} info`, color: 'gray' }]],
          ['Codes', issueText(sm.byCode) || 'none'],
          ['Report', r.sources.report.missing ? { text: 'missing', color: 'red' } : `${r.sources.report.rows} rows · full check ${r.sources.report.generatedAt}`],
          ['Freshness', `${r.sources.staleness.method} · ${r.sources.staleness.filesTraced} edited files traced`],
          ['Ledger', r.ledgerPath],
          ...(r.machine ? [['Settings', r.machine.setUp ? r.machine.settings : { text: `${r.machine.settings} (not set up)`, color: 'gray' }], ['Token files', r.machine.tokens]] : []),
          ['Running under', r.agent ? describeAgent(r.agent) : { text: 'no agent marker', color: 'gray' }],
          // Warn mode, only when the config (or this run's --warn / --enforce) sets it.
          ...(() => {
            try {
              const P = ctx().P;
              const enf = resolveEnforcement(P, { flags });
              return P.config.enforcement != null || enf.configured.length || flags.enforce ? [['Enforcement', describeEnforcement(enf)]] : [];
            } catch (e) {
              return [['Enforcement', { text: e.message, color: 'red' }]];
            }
          })(),
        ],
      },
    ];
    if (r.components.total) {
      blocks.push({ h: flags.component || flags.status ? 'Components' : 'Components needing attention' });
      blocks.push({
        table: {
          cols: [
            { key: 'st', label: 'Status' },
            { key: 'c', label: 'Component' },
            { key: 'n', label: 'Entries', right: true },
            { key: 'why', label: 'Issues' },
          ],
          rows: r.components.list.map((c) => ({ st: sevCell(c.status, c.severity), c: c.component, n: c.entries, why: issueText(c.counts) })),
          more: r.components.total - r.components.shown,
          moreHint: 'raise --limit',
        },
      });
    } else blocks.push({ note: 'Every component is clean.', tone: 'ok' });
    if (r.entries.total && (flags.component || flags.status || r.entries.list.some((x) => x.severity === 'error'))) {
      const list = flags.component || flags.status ? r.entries.list : r.entries.list.filter((x) => x.severity === 'error');
      blocks.push({ h: 'Entries' });
      blocks.push({
        table: {
          cols: [
            { key: 'st', label: 'Status' },
            { key: 'id', label: 'Entry' },
            { key: 'why', label: 'Why' },
          ],
          rows: list.map((x) => ({ st: sevCell(x.status, x.severity), id: x.id, why: x.issues.find((i) => i.code === x.status)?.reason ?? '' })),
          more: (flags.component || flags.status ? r.entries.total : list.length) - list.length,
          moreHint: 'filter with --component / --status, or raise --limit',
        },
      });
    }
    if (r.plan) {
      blocks.push({ h: repair === 'apply' ? 'Repairs' : 'Repair plan (dry run)', sub: 'never writes signatures, never approves' });
      if (!r.plan.steps.length) blocks.push({ note: 'Nothing to repair automatically.', tone: 'ok' });
      else
        blocks.push({
          table: {
            cols: [
              { key: 'a', label: 'Step' },
              { key: 'n', label: 'Entries', right: true },
              { key: 'r', label: repair === 'apply' ? 'Result' : 'What it does' },
            ],
            rows: r.plan.steps.map((st, i) => ({
              a: st.action,
              n: st.ids.length,
              r: repair === 'apply' ? r.applied?.[i]?.result ?? '' : st.blocked ? { text: `blocked: ${st.blocked}`, color: 'yellow' } : st.why,
            })),
          },
        });
      if (r.plan.manual.length) {
        blocks.push({ h: 'Needs a person' });
        blocks.push({ list: r.plan.manual.map((m) => `${m.count} ${m.code} — ${m.what}`) });
      }
    }
    const next = [];
    if (repair === 'none' && sm.status !== 'clean') next.push([`${CMD} doctor --repair`, 'the safe repairs, as a dry-run plan']);
    if (repair === 'plan' && r.plan?.steps.some((x) => !x.blocked)) next.push([`${CMD} doctor --repair --apply`, 'run them (add --only register to sync the manifest only)']);
    if (!flags.component && r.components.list[0]) next.push([`${CMD} doctor --component ${r.components.list[0].component.split('/').pop()}`, 'every entry of one component']);
    blocks.push({ next });
    // --fail-on: error → errors; warn → errors + warnings; info → also info findings, never ok / excluded / drift.
    const findings = { error: sm.bySeverity.error, warn: sm.bySeverity.warn, info: sm.infoFindings ?? 0 };
    const rank = { error: 0, warn: 1, info: 2 };
    const over = Object.entries(findings).filter(([k]) => rank[k] <= rank[failOn]).reduce((n, [, c]) => n + c, 0);
    // A setup error is never warned (exit 2 in every mode); findings at or above --fail-on are the doctor gate.
    const g = gate(
      [
        ...(r.setup.some((x) => x.severity === 'error') ? [{ gate: null, exit: 2, count: r.setup.filter((x) => x.severity === 'error').length, what: 'setup errors' }] : []),
        { gate: 'doctor', exit: over ? 1 : 0, count: over, what: `findings at or above --fail-on ${failOn}` },
      ],
      'doctor',
      { doctor: over }
    );
    return { blocks: [...g.lead, ...blocks, ...g.last], data: { ...r, ...g.data }, exit: g.exit, advisory: g.advisory };
}

// --- commands ------------------------------------------------------------------------------------
/**
 * `pxsig serve --link`: a fresh dashboard link from the running server, for a person at this
 * terminal. The server answers only the CLI's token; the link is printed, never logged.
 */
async function serveLink() {
  if (!humanAtTerminal()) fail(`the dashboard link is for a person: run \`pxsig serve --link\` yourself in a terminal (${whyNotPerson()})`, 3);
  const ws = findWorkspace({});
  const url = serverUrlFor(ws.root);
  const token = readToken(ws.root, url);
  if (!token) fail(`no pxsig server is running for this workspace (${url}): start it with \`${CMD} serve\``);
  let r;
  try {
    r = await fetch(`${url}/__pxsig/ticket`, { method: 'POST', headers: { [TOKEN_HEADER]: token } });
  } catch {
    fail(`the pxsig server at ${url} does not answer: start it with \`${CMD} serve\``);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) fail(`the pxsig server at ${url} refused: ${body.error ?? r.status} (restart \`${CMD} serve\` with this version)`);
  process.stdout.write(`${body.link}\n`);
  process.stderr.write('Open it once, within two minutes: that browser can then approve from the dashboard until the server stops.\n');
}

const commands = {
  status: () => overProjects(async () => {
    const s = await run('status');
    const order = ['changed', 'error', 'flaky', 'rejected', 'approved', 'drift', 'pass', 'skipped'];
    const counts = order
      .filter((k) => s.counts[k])
      .map((k) => ({ ...stateCell(k), text: `${stateCell(k).text} ${s.counts[k]}` }));
    const age = Math.round((Date.now() - new Date(s.reportUpdated)) / 60000);
    const blocks = [
      {
        h: 'pxsig',
        sub: `${s.entries} entries · ${s.modes?.join(' + ') ?? ''} · report ${age < 1 ? 'just now' : `${age} min ago`}`,
      },
      {
        kv: [
          ['States', counts],
          [
            'a11y',
            s.a11y.new
              ? { text: `${s.a11y.violations} violations, ${s.a11y.new} new`, color: 'red' }
              : `${s.a11y.violations} violations, none new`,
          ],
          [
            'Server',
            s.server.up
              ? {
                  text: `up${s.server.running ? ', checking' : ''}${s.server.queued ? `, ${s.server.queued} queued` : ''} · ${s.server.dashboard}`,
                  color: 'green',
                }
              : { text: `down — ${s.server.hint ?? `start it: ${CMD} serve`}`, color: 'red' },
          ],
          [
            'Integrity',
            (() => {
              const L = (() => {
                try {
                  return JSON.parse(readFileSync(join(ctx().P.store.reports, 'integrity.json'), 'utf8'));
                } catch {
                  return null;
                }
              })();
              if (!L) return { text: `not computed — ${CMD} doctor`, color: 'yellow' };
              return { text: L.summary.headline, color: L.summary.status === 'attention' ? 'red' : L.summary.status === 'warnings' ? 'yellow' : 'green' };
            })(),
          ],
          // Warn mode, only when the config chose it: the gates, the date, the readiness tally.
          ...(s.enforcement?.warned?.length
            ? [[
                'Warn mode',
                {
                  text: `${s.enforcement.warned.join(', ')}${s.enforcement.warnUntil ? ` until ${s.enforcement.warnUntil}` : ''}${s.enforcement.readiness ? ` · would-fail runs ${s.enforcement.readiness.wouldFail} of ${s.enforcement.readiness.runs}${s.enforcement.readiness.main ? ` (${s.enforcement.readiness.main.branch} ${s.enforcement.readiness.main.wouldFail} of ${s.enforcement.readiness.main.runs})` : ''}` : ''}`,
                  color: 'yellow',
                },
              ]]
            : []),
          [
            'Fresh',
            s.stale
              ? {
                  text: `${s.stale.editedFiles.length} files edited since the report → ${s.stale.affectedEntries ?? '?'} entries not re-checked`,
                  color: 'yellow',
                }
              : { text: 'no edits since the report', color: 'green' },
          ],
        ],
      },
    ];
    if (s.mostChanged.length) {
      blocks.push({ h: 'Most changed' });
      blocks.push({
        table: {
          cols: [
            { key: 'c', label: 'Component' },
            { key: 'n', label: 'Entries', right: true },
          ],
          rows: s.mostChanged.slice(0, 8).map((m) => ({ c: m.component, n: m.n })),
          more: Math.max(0, s.mostChanged.length - 8),
        },
      });
    }
    const next = [];
    if (s.stale)
      next.push([
        `${CMD} check --changed ${s.stale.editedFiles.slice(0, 3).join(',')}${s.stale.editedFiles.length > 3 ? ',…' : ''}`,
        're-check what the edits affect',
      ]);
    if (s.problems) next.push([`${CMD} list`, `the ${s.problems} entries needing review`]);
    if (s.a11y.new) next.push([`${CMD} a11y --new`, 'new accessibility violations']);
    blocks.push({ next });
    return { blocks, data: s };
  }),

  stale: () => overProjects(async () => {
    const s = await run('stale', { limit: Number(flags.limit) || 200 });
    const bad = s.stale + s.inconsistent;
    const blocks = [
      { h: 'Freshness', sub: `${s.of} entries` },
      {
        note: bad
          ? `${s.stale} stale · ${s.inconsistent} inconsistent — these verdicts predate edits that can change them`
          : 'Every result is newer than the edits that can change it.',
        tone: bad ? 'warn' : 'ok',
      },
    ];
    if (Object.keys(s.byFile ?? {}).length)
      blocks.push({
        table: {
          cols: [
            { key: 'f', label: 'Edited file' },
            { key: 'n', label: 'Entries', right: true },
          ],
          rows: Object.entries(s.byFile).map(([f, n]) => ({
            f,
            n: Array.isArray(n) ? n.length : n,
          })),
        },
      });
    if (bad)
      blocks.push({
        next: [
          [
            `${CMD} check ${s.ids.slice(0, 3).join(' ')}${s.ids.length > 3 ? ' …' : ''}`,
            `re-check the ${s.ids.length} stale entries`,
          ],
        ],
      });
    const g = gate([{ gate: 'stale', exit: bad ? 1 : 0, count: bad, what: 'stale or inconsistent verdicts' }], 'stale', { stale: bad });
    return { blocks: [...g.lead, ...blocks, ...g.last], data: { ...s, ...g.data }, exit: g.exit, advisory: g.advisory };
  }),

  list: () => overProjects(async () => {
    const state = rest[0] ?? flags.state ?? 'problems';
    const limit = Number(flags.limit) || 30;
    const s = await run('list', { state, component: flags.component, mode: flags.mode, limit });
    const blocks = [
      {
        h: `Entries: ${state}`,
        sub: `${s.total} match${flags.component ? ` · component ~ ${flags.component}` : ''}${flags.mode ? ` · ${flags.mode}` : ''}`,
      },
      s.total
        ? entryTable(s.entries, { more: s.total - s.shown })
        : { note: 'Nothing matches.', tone: 'ok' },
    ];
    if (s.total)
      blocks.push({
        next: [[`${CMD} entry ${s.entries[0].id}${current && !project ? ` --project ${current}` : ''}`, 'verdict and images for one entry']],
      });
    return { blocks, data: s };
  }),

  async entry() {
    current = oneProject();
    const id = rest[0] ?? fail('usage: entry <id>');
    const kinds = list(flags.images).length ? list(flags.images) : ['baseline', 'current', 'diff'];
    // Ask the tool for no images: the CLI shows paths (or inlines files) itself.
    const res = await run('entry', { id, images: [] }).catch((e) => fail(e.message));
    const e = JSON.parse(res.content[0].text);
    const m = e.metrics ?? {};
    const regions = e.pixels?.regions ?? [];
    const images = kinds.map((k) => {
      const { bytes, where } = imageOf(ctx(), k, id);
      return {
        label: k,
        path: where,
        missing: !bytes,
        data: bytes && format === 'pretty' ? bytes : null,
      };
    });
    const blocks = [
      { h: id, sub: [e.mode, e.interaction].filter(Boolean).join(' · ') },
      {
        kv: [
          ['State', stateCell(e.state)],
          ['SSIM', `${m.ssim ?? '—'}  (gate ${e.reasons?.length ? 'tripped' : 'held'})`],
          [
            'Changed',
            `${e.changedPx ?? 0} px in ${regions.length} region${regions.length === 1 ? '' : 's'} · ${pct(m.changedCellsPct ?? 0)} of cells`,
          ],
          [
            'a11y',
            e.a11y?.violations?.length
              ? { text: e.a11y.violations.map((v) => v.id ?? v).join(', '), color: 'red' }
              : 'clean',
          ],
          ['Review', e.review?.decision ?? 'none'],
          ['Checked', e.checkedAt ?? '—'],
          ['Dashboard', { text: inspectUrl(id), url: inspectUrl(id) }],
        ],
      },
    ];
    if (e.reasons?.length) blocks.push({ h: 'Why' }, { list: e.reasons });
    if (regions.length)
      blocks.push(
        { h: 'Regions' },
        {
          table: {
            cols: [
              { key: 'xy', label: 'x, y' },
              { key: 'wh', label: 'w × h' },
              { key: 'px', label: 'px', right: true },
            ],
            rows: regions
              .slice(0, 8)
              .map((r) => ({ xy: `${r.x}, ${r.y}`, wh: `${r.w} × ${r.h}`, px: r.px })),
            more: Math.max(0, regions.length - 8),
          },
        }
      );
    blocks.push({ h: 'Images' }, { images });
    if (format === 'plain')
      blocks.push({ note: 'Open the PNG paths above to compare baseline and current.' });
    emit(format, blocks, {
      ...e,
      images: Object.fromEntries(images.map((i) => [i.label, i.missing ? null : i.path])),
    });
  },

  async check() {
    // The full check (render everything selected, suites, --update) runs check.mjs itself.
    if (flags.full || flags.update || flags.suite || flags.modes) {
      const pass = process.argv.slice(3).filter((a) => a !== '--full' && !['--json', '--plain', '--pretty', '--markdown'].includes(a));
      if (!project) pass.push('--project', oneProject());
      const r = spawnSync(process.execPath, [join(here, 'check.mjs'), ...pass], { stdio: 'inherit' });
      process.exit(r.status ?? 2);
    }
    current = oneProject();
    const args = {
      ids: rest,
      changed_files: list(flags.changed),
      since: typeof flags.since === 'string' ? flags.since : undefined,
      all: !!flags.all,
    };
    if (!args.ids.length && !args.changed_files.length && !args.since && !args.all)
      fail(`usage: check <ids…> | --changed a,b | --since <ref> | --all`);
    const spin = progress(format, 'checking');
    // The server queue is the only progress signal; poll it for the spinner's text.
    const poll = setInterval(async () => {
      try {
        const s = await (
          await fetch(`${ctx().serverUrl}/__pxsig/status`, { signal: AbortSignal.timeout(1000) })
        ).json();
        spin.update(s.running ? `checking · ${s.queued ?? 0} queued` : 'checking');
      } catch {}
    }, 700);
    let r;
    try {
      r = await run('check', args);
    } catch (e) {
      clearInterval(poll);
      spin.done(e.message, false);
      process.exit(2);
    }
    clearInterval(poll);
    if (r.timedOut) return (spin.done('still running', false), fail(r.note, 2));
    const problems = r.problems ?? [];
    const errs = problems.filter((p) => p.state === 'error');
    spin.done(`checked ${r.checked ?? 0} entries via ${r.via ?? '—'}`, !errs.length);
    const counts = Object.entries(r.counts ?? {}).map(([k, n]) => ({
      ...stateCell(k),
      text: `${stateCell(k).text} ${n}`,
    }));
    const blocks = [
      { h: 'Check', sub: `${r.checked ?? 0} entries · ${r.seconds ?? '?'} s · ${r.via ?? ''}` },
      { kv: [['States', counts.length ? counts : 'nothing selected']] },
    ];
    if (errs.length && errs.every((p) => /ERR_CONNECTION_REFUSED/.test(p.error ?? '')))
      blocks.push({
        note: 'Storybook is not running, so nothing rendered: start the project Storybook (storybook.url in pxsig.config.json)',
        tone: 'bad',
      });
    if (problems.length)
      blocks.push(entryTable(problems.slice(0, 40), { more: Math.max(0, problems.length - 40) }));
    if (r.registered?.length) blocks.push({ note: `registered ${r.registered.length} NEW entries (no signature: approve their first render in the dashboard)`, tone: 'warn' });
    for (const x of r.skipped ?? []) blocks.push({ note: `not checked: ${x.name}: ${x.why}`, tone: 'bad' });
    // Integrity: what this run could not cover, in one line.
    let ledger = null;
    try {
      ledger = await doctor({ limit: 0 });
      blocks.push({ note: `integrity: ${ledger.summary.headline}`, tone: ledger.summary.status === 'attention' ? 'bad' : 'ok' });
    } catch {}
    const next = [];
    if (problems.length) next.push([`${CMD} entry ${problems[0].id}`, 'see what changed']);
    if (ledger?.summary.status === 'attention') next.push([`${CMD} doctor`, 'per-component integrity']);
    blocks.push({ next });
    // Warn mode: the visual gate on the problems, the a11y gate on the entries with new violations.
    const a11yNew = r.a11yNew ?? 0;
    const g = gate(
      [
        ...(!r.checked && r.skipped?.length ? [{ gate: null, exit: 2, count: r.skipped.length, what: 'names not checked' }] : []),
        { gate: 'visual', exit: problems.length ? 1 : 0, count: problems.length, what: 'not passing' },
        { gate: 'a11y', exit: a11yNew ? 1 : 0, count: a11yNew, what: a11yNew === 1 ? 'entry with new a11y violations' : 'entries with new a11y violations' },
      ],
      'check',
      { changed: problems.length, a11yNew }
    );
    emit(format, [...g.lead, ...blocks, ...g.last], { ...r, integrity: ledger?.summary ?? null, ...g.data });
    // Nothing checked because every name was skipped: a selection error, like an empty one.
    process.exit(g.exit);
  },

  async affected() {
    current = oneProject();
    const since = typeof flags.since === 'string' ? flags.since : undefined;
    if (!rest.length && !since) fail('usage: affected <files…> | --since <ref>');
    const files = rest.map((f) => relPath(ctx().root, resolve(f)));
    const r = await run('affected', since ? { since } : { files });
    const blocks = [
      { h: 'Affected', sub: `${r.entries} entries · ${r.reason}` },
    ];
    // The fail-safe: what the selection cannot trace selects every entry. Each `outside` path is a
    // candidate for affects.ignore (docs/ci.md, "How selection decides").
    if (r.failSafe?.length) blocks.push({ h: 'Every entry selected because of', sub: `${r.failSafe.length} paths` }, { list: r.failSafe.slice(0, 10).map((f) => `${f.why} (${f.class})`) }, ...(r.failSafe.length > 10 ? [{ note: `…${r.failSafe.length - 10} more in --json` }] : []), { note: 'A path that never changes a render can go in affects.ignore.' });
    else blocks.push({ list: r.ids.slice(0, 40).map(idCell) }, ...(r.ids.length > 40 ? [{ note: `…${r.ids.length - 40} more` }] : []));
    for (const [s, n] of Object.entries(r.otherSuites ?? {})) blocks.push({ note: `${n} changed entries are in suite ${s}: pxsig check --suite ${s}` });
    // Unresolved imports add the entries that reach them to every run (decision 6.1d).
    const costly = (r.unresolved ?? []).filter((u) => !u.accepted && u.selects !== 'none');
    if (costly.length)
      blocks.push(
        { h: 'Checked on every run: unresolved imports', sub: `${costly.length} imports` },
        { list: costly.slice(0, 10).map((u) => `${u.file}:${u.line} \`${u.spec}\` (${u.why}) → ${u.selects === 'all' ? 'every entry' : `${u.n} entries`}`) },
        ...(costly.length > 10 ? [{ note: `…${costly.length - 10} more in --json` }] : []),
        { note: 'Map a bundler alias with affects.aliases, or accept the file with affects.unresolved.' },
      );
    if (r.remote?.length) blocks.push({ note: `${r.remote.length} remote URLs are not followed (a full check covers them).` });
    if (r.entries)
      blocks.push({
        next: [
          [
            `${CMD} check ${since ? `--since ${since}` : `--changed ${files.join(',')}`}`,
            're-check them',
          ],
        ],
      });
    emit(format, blocks, r);
  },

  a11y: () => (flags.prune ? a11yPrune() : overProjects(async () => {
    const r = await run('a11y', {
      component: flags.component,
      only_new: !!flags.new,
      limit: Number(flags.limit) || 50,
    });
    const rules = Object.entries(r.byRule ?? {}).sort((a, b) => b[1] - a[1]);
    const blocks = [{ h: flags.new ? 'New a11y violations' : 'a11y', sub: `${r.entries} entries` }];
    // --sarif: the new violations of the last report, for SARIF viewers (decision 96).
    if (typeof flags.sarif === 'string') {
      const C = ctx();
      const report = JSON.parse(readFileSync(join(C.P.store.reports, 'check.json'), 'utf8'));
      const manifest = JSON.parse(readFileSync(C.P.manifestPath(), 'utf8'));
      const n = writeSarif(resolve(flags.sarif), report.rows.filter((x) => !flags.component || x.id.includes(String(flags.component).toLowerCase())), { entries: new Map(manifest.stories.map((e) => [e.id, e])) });
      blocks.push({ note: `${n} new violations written to ${flags.sarif} (SARIF 2.1.0)` });
    }
    if (!r.entries) blocks.push({ note: 'No violations.', tone: 'ok' });
    else {
      blocks.push({
        table: {
          cols: [
            { key: 'rule', label: 'Rule' },
            { key: 'n', label: 'Entries', right: true },
          ],
          rows: rules.map(([rule, n]) => ({ rule, n })),
        },
      });
      blocks.push({
        list: r.list.map((e) => ({
          text: `${e.id} — ${(e.violations ?? []).map((v) => v.id ?? v).join(', ')}`,
        })),
      });
    }
    return { blocks, data: r };
  })),

  history: () => overProjects(async () => {
    const r = await run('history', { limit: Number(flags.limit) || 10 });
    const blocks = [
      { h: 'History', sub: `last ${r.runs.length} runs` },
      {
        table: {
          cols: [
            { key: 'at', label: 'When' },
            { key: 'n', label: 'Entries', right: true },
            { key: 'f', label: 'Changed', right: true },
            { key: 'ids', label: 'First changed' },
          ],
          rows: r.runs
            .reverse()
            .map((h) => ({
              at: h.at?.replace('T', ' ').slice(0, 19),
              n: h.entries,
              f: h.failed ?? 0,
              ids: h.failedIds.slice(0, 2).join(', '),
            })),
        },
      },
    ];
    return { blocks, data: r };
  }),

  async doctor() {
    const repair = flags.repair ? (flags.apply ? 'apply' : 'plan') : 'none';
    if (flags.prune && repair !== 'apply') fail('--prune only acts with --repair --apply');
    if (flags.prune && !humanAtTerminal())
      fail(`--prune moves files: run it yourself in a terminal (${whyNotPerson()})`, 3);
    const only = list(flags.only);
    const ACTIONS = ['register', 'recheck', 'restore-baseline-image', 'convert-legacy', 'log-torn'];
    if (only.includes('log-torn') && repair === 'apply' && !humanAtTerminal())
      fail(`--only log-torn rewrites the approval log: run it yourself in a terminal (${whyNotPerson()})`, 3);
    const bad = only.filter((a) => !ACTIONS.includes(a));
    if (bad.length) fail(`unknown repair action(s): ${bad.join(', ')} (${ACTIONS.join(', ')})`);
    const failOn = flags['fail-on'] ?? (flags.ci ? 'error' : 'warn');
    if (!['error', 'warn', 'info'].includes(failOn)) fail('--fail-on takes error, warn or info');
    // Repairs write the store: one project, and the store lock (or the server that holds it).
    return overProjects(() => doctorOne({ repair, only, failOn }), repair === 'apply' ? [oneProject()] : undefined);
  },

  approve() {
    current = oneProject();
    const C = ctx();
    return approveCommand({ sub: rest[0], args: rest.slice(1), flags, format, tools, project: C.P, serverUrl: C.serverUrl, CMD, fail });
  },

  async projects() {
    const r = await run('projects');
    emit(
      format,
      [
        { h: 'Projects', sub: r.workspace },
        {
          table: {
            cols: [
              { key: 'name', label: 'Project' },
              { key: 'root', label: 'Folder' },
              { key: 'entries', label: 'Entries', right: true },
              { key: 'integrity', label: 'Integrity' },
            ],
            rows: r.projects.map((p) => ({ name: p.name, root: p.root ?? '', entries: p.entries ?? '', integrity: p.error ?? p.integrity ?? 'not computed' })),
          },
        },
      ],
      r
    );
  },

  init() {
    const dir = resolve(rest[0] ?? '.');
    let wsRoot = null;
    try {
      const ws = findWorkspace({ cwd: dir });
      if (ws.file) wsRoot = ws.root;
    } catch {
      // no workspace above: a single-package project
    }
    const s = (k) => (typeof flags[k] === 'string' ? flags[k] : null);
    const wrote = initProject({ dir, name: s('name'), srcRoot: s('src') ?? 'src', storybookUrl: s('storybook-url'), storybookConfigDir: s('storybook-config'), workspaceRoot: wsRoot, layout: s('layout') });
    emit(format, [{ h: 'pxsig init', sub: dir }, wrote.length ? { list: wrote.map((p) => relPath(process.cwd(), p) || p) } : { note: 'already set up: nothing written' }, { next: [[`${CMD} manifest`, 'list the stories to check (Storybook must be running)'], [`${CMD} check --full`, 'render and check them']] }], { wrote });
  },

  config() {
    const P = openProject({ project: oneProject() });
    const d = describeConfig(P);
    // Warn mode, when the config sets it: each gate's setting, the layer that set it, the days left.
    let enf = null;
    if (P.config.enforcement != null)
      try {
        enf = resolveEnforcement(P, { flags });
      } catch (e) {
        enf = { error: e.message };
      }
    if (enf) d.enforcement = enf.error ? enf : { gates: enf.gates, layers: enf.layers, warnUntil: enf.warnUntil, daysLeft: enf.daysLeft, advisoryExit: enf.advisoryExit };
    if (format === 'json') return process.stdout.write(`${JSON.stringify(d, null, 2)}\n`);
    const get = (o, k) => k.split('.').reduce((v, x) => (v == null ? v : v[x]), o);
    const show = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    const rel = (p) => (p ? relPath(process.cwd(), p) || '.' : '—');
    const rows = Object.keys(d.sources)
      .sort()
      .map((k) => ({ k, v: k === 'modes' ? Object.keys(d.modes).join(', ') : show(get(d.config, k)), from: { text: d.sources[k], color: d.sources[k] === 'defaults' ? 'gray' : d.sources[k] === 'flags' || d.sources[k] === 'env' ? 'yellow' : undefined } }));
    emit(
      format,
      [
        { h: 'pxsig config', sub: d.project },
        { kv: [['Workspace file', rel(d.workspaceFile)], ['Project config', rel(d.configFile)], ['Source root', rel(d.srcRoot)], ['Store', `${rel(d.store.root)} (${d.store.layout})`], ['Storybook', d.storybook.url], ['Binary', rel(d.rustBin)]] },
        { h: 'Settings', sub: 'later layers win: defaults < workspace defaults < project config < env < flags' },
        { table: { cols: [{ key: 'k', label: 'Key' }, { key: 'v', label: 'Value' }, { key: 'from', label: 'Set by' }], rows } },
        ...(enf
          ? enf.error
            ? [{ h: 'Enforcement' }, { note: enf.error, tone: 'bad' }]
            : [
                { h: 'Enforcement', sub: `${enf.warnUntil ? `warn until ${enf.warnUntil}${enf.daysLeft != null ? ` (${enf.daysLeft} days left)` : ' (passed)'} · ` : ''}advisory exit ${enf.advisoryExit}` },
                { table: { cols: [{ key: 'g', label: 'Gate' }, { key: 'v', label: 'Setting' }, { key: 'from', label: 'Set by' }], rows: Object.entries(enf.gates).map(([g, v]) => ({ g, v: { text: v, color: v === 'warn' ? 'yellow' : v === 'off' ? 'gray' : undefined }, from: enf.layers[g] })) } },
              ]
          : []),
      ],
      d
    );
  },

  async manifest() {
    const P = openProject({ project: oneProject() });
    const { ensureStorybook } = await import('./lib/static.mjs');
    const sb = await ensureStorybook(P, { log: (m) => format !== 'json' && process.stderr.write(`[manifest] ${m}\n`) });
    const spin = progress(format, 'reading stories from Storybook');
    let r;
    try {
      r = await buildManifest(P, { suite: typeof flags.suite === 'string' ? flags.suite : null });
    } catch (e) {
      spin.done(e.message, false);
      fail(e.message, 2);
    } finally {
      if (sb.served) await sb.close();
    }
    spin.done(`${r.manifest.stories.length} entries · ${r.added.length} new · ${r.removed.length} removed`);
    emit(format, [{ h: 'Manifest', sub: relPath(process.cwd(), r.path) }, { kv: [['Entries', String(r.manifest.stories.length)], ['New (no baseline yet)', String(r.added.length)], ['Removed', String(r.removed.length)], ['Skipped', String(r.skipped.length)]] }], { path: r.path, added: r.added, removed: r.removed, skipped: r.skipped });
  },

  async serve() {
    if (flags.link) return serveLink();
    const pass = process.argv.slice(3);
    const child = spawn(process.execPath, [join(here, 'serve.mjs'), ...pass], { stdio: 'inherit' });
    child.on('exit', (c) => process.exit(c ?? 0));
    // `kill <pid>` (a process manager, a script) stops the server too, not only this wrapper: an
    // orphaned server kept its port, its store lock and its record in server.json. Ctrl+C reaches
    // the whole process group by itself.
    for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
  },

  mcp() {
    spawn(process.execPath, [join(here, 'mcp.mjs')], { stdio: 'inherit' }).on('exit', (c) => process.exit(c ?? 0));
  },

  report() {
    const r = spawnSync(process.execPath, [join(here, 'report.mjs'), ...process.argv.slice(3)], { stdio: 'inherit' });
    process.exit(r.status ?? 2);
  },

  cat() {
    const r = spawnSync(rustBinary(), ['cat', ...process.argv.slice(3)], { stdio: 'inherit' });
    process.exit(r.status ?? 2);
  },

  async migrate() {
    const from = typeof flags.from === 'string' ? flags.from : fail('usage: migrate --from <legacy pxsig folder> [--apply]');
    const P = openProject({ project: oneProject() });
    let lock = null;
    if (flags.apply)
      try {
        lock = await takeLock(P, { holder: 'migrate' });
        lock.check();
      } catch (e) {
        fail(e.message, e.exit ?? 2);
      }
    let plan;
    try {
      plan = migrateLegacy(P, { from, apply: !!flags.apply, verify: !flags['no-verify'], log: (m) => format !== 'json' && process.stderr.write(`[migrate] ${m}\n`) });
    } finally {
      lock?.release();
    }
    const blocks = [
      { h: flags.apply ? 'Migrated' : 'Migration plan (dry run)', sub: `${relPath(process.cwd(), plan.from)} → ${relPath(process.cwd(), plan.to)}` },
      { kv: [['Baselines', `${plan.summary.baselines} (${plan.summary.withImage} with an image)`], ['Manifests', plan.summary.manifests.join(' · ')], ['Files copied', String(plan.summary.copies)], ['Approvals trail', plan.summary.approvals ? 'carried over' : 'none'], ['Problems', String(plan.summary.problems)]] },
    ];
    if (plan.problems.length) blocks.push({ h: 'Problems' }, { list: plan.problems.slice(0, 20) });
    if (plan.verify) blocks.push({ h: 'Verification' }, { list: plan.verify.map((v) => `${v.suite ?? 'main'}: ${v.entries} entries · pass ${v.passOld} → ${v.passNew} · ${v.differ} differ${v.differ ? `: ${v.sample.join(', ')}` : ''}`) });
    if (!flags.apply) blocks.push({ next: [[`${CMD} migrate --from ${from} --apply`, 'run it (the legacy folder is only read)']] });
    const { pack, manifests, ...json } = plan;
    emit(format, blocks, { ...json, manifests: manifests.map(({ manifest, ...m }) => m) });
    if (plan.problems.length || plan.verify?.some((v) => v.differ)) process.exit(1);
  },

  async setup() {
    const { setupCommand } = await import('./setup.mjs');
    let r;
    try {
      r = await setupCommand({
        step: rest[0] ?? null,
        flags: { assistant: flags.assistant, print: flags.print || format === 'json' },
        person: humanAtTerminal(),
        ask,
        show: (blocks) => emit(format, blocks, null),
        CMD,
      });
    } catch (e) {
      fail(e.message, e.exit ?? 2);
    }
    emit(format, r.blocks, r.data);
    process.exit(r.exit);
  },

  async browser() {
    const { browserCommand } = await import('./browser.mjs');
    let root = null;
    let P = null;
    try {
      root = findWorkspace({}).root;
      P = openProject({ project: project ?? null });
    } catch {
      // several projects and none chosen, or no workspace: the root alone is enough
    }
    let r;
    try {
      r = await browserCommand({ sub: rest[0] ?? 'status', flags, root, P, CMD });
    } catch (e) {
      fail(e.message, e.exit ?? 2);
    }
    emit(format, r.blocks, r.data);
    process.exit(r.exit);
  },

  async dashboard() {
    const { dashboardCommand } = await import('./dashboard.mjs');
    process.exitCode = await dashboardCommand(rest[0], { ...flags, json: format === 'json' });
  },

  help() {
    // `pxsig help <name>` and `pxsig <command> [sub] --help`: one page. Alone: the header below.
    const words = command === 'help' ? rest : flags.help ? positional : [];
    if (words.length) {
      // `pxsig list changed --help`: the word after a command is an argument, not a subcommand.
      const found = lookup(words) ?? (command !== 'help' ? lookup(words.slice(0, 1)) : null);
      if (!found) fail(`no command, topic or setting "${words.join(' ')}" — nearest: ${nearestNames(words.join(' ')).join(', ')}`);
      return emit(format, helpBlocks(found, CMD), helpData(found));
    }
    const doc = readFileSync(new URL(import.meta.url), 'utf8')
      .match(/\/\*\*([\s\S]*?)\*\//)[1]
      .replace(/^ \* ?/gm, '')
      .trim();
    process.stdout.write(doc + '\n');
  },
};

if (flags.help || command === '--help') commands.help();
else if (!commands[command]) fail(`unknown command "${command}" — try: ${Object.keys(commands).join(', ')}`);
else
  try {
    await commands[command]();
  } catch (e) {
    // Setup errors (no workspace, no project, unreadable config) and anything unexpected: exit 2.
    fail(e.message, 2);
  }
