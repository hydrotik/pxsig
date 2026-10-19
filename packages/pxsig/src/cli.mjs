#!/usr/bin/env node
/**
 * cli.mjs — `pxsig`: the harness from a shell, for people and for agents.
 *
 *   pxsig [command] [args] [--project name | --all] [--workspace dir] [--json | --plain | --markdown | --pretty]
 *         [--storybook-url u] [--storybook-static dir] [--grid n]     (config flags: the top layer)
 *
 *   projects                    the projects in this workspace, with their store and integrity
 *   init [dir] [--name x] [--src src] [--storybook-url url] [--storybook-config dir] [--layout colocated]
 *                               set a package up: pxsig.config.json, its store, the workspace entry
 *                               (colocated: also `*.psig binary diff=psig` in the root .gitattributes)
 *   config                      the resolved config of a project, and which layer set each key
 *   manifest [--suite x]        rebuild the project's entries from the running Storybook
 *   serve [--watch] [--port n]  the server and dashboard, for every project
 *   mcp                         the MCP server (stdio)
 *   report [--out dir]          a static dashboard for one project
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
 *   a11y [--component x] [--new]
 *                               axe violations per entry
 *   history [--limit 10]        the last runs
 *   doctor [--component x] [--status code,…] [--ci] [--fail-on error|warn|info] [--offline] [--limit 40]
 *                               integrity per component: unregistered stories, never-checked entries, missing
 *                               baseline images / renders, render errors, stale verdicts, orphans (docs/integrity.md)
 *   doctor --repair [--only register,recheck,restore-baseline-image,convert-legacy] [--apply] [--prune]
 *                               the safe repairs: a dry-run plan, or with --apply run them. Never changes a
 *                               signature or approves; --prune (a person at a terminal) moves orphans to trash/
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
 * Per-entry approve / reject stays in the dashboard and Storybook panel, where a person sees the images.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approveCommand } from './approve.mjs';
import { ctxOf, doctor, imageOf, tools } from './mcp.mjs';
import { parseArgs } from './lib/args.mjs';
import { CODES } from './lib/integrity.mjs';
import { acquireLock, describeLock, readLock } from './lib/lock.mjs';
import { buildManifest, describeConfig, initProject, migrateLegacy } from './lib/setup.mjs';
import { findWorkspace, flagLayer, openProject, pickProject, rustBinary, setFlagLayer } from './lib/workspace.mjs';
import { ask, emit, humanAtTerminal, pickFormat, progress, stateCell } from './lib/term.mjs';

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
  let exit = 0;
  for (const name of names) {
    current = name;
    try {
      const r = await render();
      blocks.push(...forProject(name, r.blocks));
      data.push({ project: name, ...r.data });
      exit = Math.max(exit, r.exit ?? 0);
    } catch (e) {
      blocks.push({ h: name }, { note: e.message, tone: 'bad' });
      data.push({ project: name, error: e.message });
      exit = 2;
    }
  }
  emit(format, blocks, { projects: data });
  process.exit(exit);
}

/** Write commands need exactly one project. */
function oneProject() {
  if (project) return project;
  const ws = findWorkspace({});
  const ref = pickProject(ws, { cwd: process.cwd() });
  if (!ref) fail(`this workspace has ${ws.projects.length} projects; "${command}" changes one: choose it with --project (${ws.projects.map((p) => p.name).join(', ')})`);
  return ref.name;
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
        viaServer = held.url ?? ctx().serverUrl;
      } else
        try {
          lock = acquireLock(P, { holder: 'doctor --repair' });
        } catch (e) {
          spin.done(e.message, false);
          fail(e.message, 2);
        }
    }
    try {
      if (viaServer) {
        // The server holds the store: its queue runs the repairs; then reconcile here to report.
        const res = await fetch(`${viaServer}/__pxsig/repair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: current, apply: true, only: only.length ? only : undefined }) });
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
        via: 'cli',
        prune: !!flags.prune,
        confirmPrune: flags.prune
          ? async (n) => {
              const phrase = `PRUNE ${n} ORPHANS`;
              return (await ask(`Move ${n} orphaned entries' files to the store trash// (nothing is deleted). Type "${phrase}" to continue: `)) === phrase;
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
    const exit = r.setup.some((x) => x.severity === 'error') ? 2 : Object.entries(findings).some(([k, n]) => n && rank[k] <= rank[failOn]) ? 1 : 0;
    return { blocks, data: r, exit };
}

// --- commands ------------------------------------------------------------------------------------
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
    return { blocks, data: s, exit: bad ? 1 : 0 };
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
    emit(format, blocks, { ...r, integrity: ledger?.summary ?? null });
    process.exit(problems.length ? 1 : 0);
  },

  async affected() {
    current = oneProject();
    const since = typeof flags.since === 'string' ? flags.since : undefined;
    if (!rest.length && !since) fail('usage: affected <files…> | --since <ref>');
    const files = rest.map((f) => relative(ctx().root, resolve(f)));
    const r = await run('affected', since ? { since } : { files });
    const blocks = [
      { h: 'Affected', sub: `${r.entries} entries · ${r.reason}` },
      { list: r.ids.slice(0, 40).map(idCell) },
    ];
    if (r.ids.length > 40) blocks.push({ note: `…${r.ids.length - 40} more` });
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

  a11y: () => overProjects(async () => {
    const r = await run('a11y', {
      component: flags.component,
      only_new: !!flags.new,
      limit: Number(flags.limit) || 50,
    });
    const rules = Object.entries(r.byRule ?? {}).sort((a, b) => b[1] - a[1]);
    const blocks = [{ h: flags.new ? 'New a11y violations' : 'a11y', sub: `${r.entries} entries` }];
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
  }),

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
      fail('--prune moves files: run it yourself in a terminal (refused when piped, in CI or under an agent)', 3);
    const only = list(flags.only);
    const ACTIONS = ['register', 'recheck', 'restore-baseline-image', 'convert-legacy'];
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
    emit(format, [{ h: 'pxsig init', sub: dir }, wrote.length ? { list: wrote.map((p) => relative(process.cwd(), p) || p) } : { note: 'already set up: nothing written' }, { next: [[`${CMD} manifest`, 'list the stories to check (Storybook must be running)'], [`${CMD} check --full`, 'render and check them']] }], { wrote });
  },

  config() {
    const d = describeConfig(openProject({ project: oneProject() }));
    if (format === 'json') return process.stdout.write(`${JSON.stringify(d, null, 2)}\n`);
    const get = (o, k) => k.split('.').reduce((v, x) => (v == null ? v : v[x]), o);
    const show = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    const rel = (p) => (p ? relative(process.cwd(), p) || '.' : '—');
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
    emit(format, [{ h: 'Manifest', sub: relative(process.cwd(), r.path) }, { kv: [['Entries', String(r.manifest.stories.length)], ['New (no baseline yet)', String(r.added.length)], ['Removed', String(r.removed.length)], ['Skipped', String(r.skipped.length)]] }], { path: r.path, added: r.added, removed: r.removed, skipped: r.skipped });
  },

  serve() {
    const pass = process.argv.slice(3);
    spawn(process.execPath, [join(here, 'serve.mjs'), ...pass], { stdio: 'inherit' }).on('exit', (c) => process.exit(c ?? 0));
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

  migrate() {
    const from = typeof flags.from === 'string' ? flags.from : fail('usage: migrate --from <legacy pxsig folder> [--apply]');
    const P = openProject({ project: oneProject() });
    let lock = null;
    if (flags.apply)
      try {
        lock = acquireLock(P, { holder: 'migrate' });
      } catch (e) {
        fail(e.message, 2);
      }
    let plan;
    try {
      plan = migrateLegacy(P, { from, apply: !!flags.apply, verify: !flags['no-verify'], log: (m) => format !== 'json' && process.stderr.write(`[migrate] ${m}\n`) });
    } finally {
      lock?.release();
    }
    const blocks = [
      { h: flags.apply ? 'Migrated' : 'Migration plan (dry run)', sub: `${relative(process.cwd(), plan.from)} → ${relative(process.cwd(), plan.to)}` },
      { kv: [['Baselines', `${plan.summary.baselines} (${plan.summary.withImage} with an image)`], ['Manifests', plan.summary.manifests.join(' · ')], ['Files copied', String(plan.summary.copies)], ['Approvals trail', plan.summary.approvals ? 'carried over' : 'none'], ['Problems', String(plan.summary.problems)]] },
    ];
    if (plan.problems.length) blocks.push({ h: 'Problems' }, { list: plan.problems.slice(0, 20) });
    if (plan.verify) blocks.push({ h: 'Verification' }, { list: plan.verify.map((v) => `${v.suite ?? 'main'}: ${v.entries} entries · pass ${v.passOld} → ${v.passNew} · ${v.differ} differ${v.differ ? `: ${v.sample.join(', ')}` : ''}`) });
    if (!flags.apply) blocks.push({ next: [[`${CMD} migrate --from ${from} --apply`, 'run it (the legacy folder is only read)']] });
    const { pack, manifests, ...json } = plan;
    emit(format, blocks, { ...json, manifests: manifests.map(({ manifest, ...m }) => m) });
    if (plan.problems.length || plan.verify?.some((v) => v.differ)) process.exit(1);
  },

  help() {
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
