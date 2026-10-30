/**
 * cli/project.mjs — `doctor`, `approve`, `projects`, `init`, `config`, `manifest`.
 */
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { approveCommand } from '../approve.mjs';
import { tools } from '../tools/index.mjs';
import { buildManifest, describeConfig, initProject } from '../lib/setup.mjs';
import { CONFIG_FILE, findWorkspace, openProject } from '../lib/workspace.mjs';
import { ask, emit, humanAtTerminal, progress, whyNotPerson } from '../lib/term.mjs';
import { relPath } from '../lib/paths.mjs';
import { resolveEnforcement } from '../lib/enforcement.mjs';
import { doctorParts } from './doctor.mjs';

/** @import { Manifest } from '../types.js' */
/** @import { ConfigValue } from '../types/t6.js' */
/** @import { CliContext } from './context.mjs' */

/** @param {CliContext} cli */
export function projectCommands(cli) {
  const { flags, format, rest, CMD, run, ctx, list, overProjects, oneProject } = cli;
  /** @type {CliContext['fail']} */
  const fail = cli.fail;
  const { doctorOne } = doctorParts(cli);

  return {
    async doctor() {
      const repair = flags.repair ? (flags.apply ? 'apply' : 'plan') : 'none';
      if (flags.prune && repair !== 'apply') fail('--prune only acts with --repair --apply');
      if (flags.prune && !humanAtTerminal())
        fail(`--prune moves files: run it yourself in a terminal (${whyNotPerson()})`, 3);
      const only = list(flags.only);
      const ACTIONS = [
        'register',
        'recheck',
        'restore-baseline-image',
        'convert-legacy',
        'log-torn',
      ];
      if (only.includes('log-torn') && repair === 'apply' && !humanAtTerminal())
        fail(
          `--only log-torn rewrites the approval log: run it yourself in a terminal (${whyNotPerson()})`,
          3
        );
      const bad = only.filter((a) => !ACTIONS.includes(a));
      if (bad.length) fail(`unknown repair action(s): ${bad.join(', ')} (${ACTIONS.join(', ')})`);
      const failOn = flags['fail-on'] ?? (flags.ci ? 'error' : 'warn');
      if (!(/** @type {unknown[]} */ (['error', 'warn', 'info']).includes(failOn)))
        fail('--fail-on takes error, warn or info');
      // Repairs write the store: one project, and the store lock (or the server that holds it).
      return overProjects(
        // failOn is one of the three: checked just above
        () => doctorOne({ repair, only, failOn: /** @type {string} */ (failOn) }),
        repair === 'apply' ? [oneProject()] : undefined
      );
    },

    approve() {
      cli.current = oneProject();
      const C = ctx();
      return approveCommand({
        sub: rest[0],
        args: rest.slice(1),
        flags,
        format,
        tools,
        project: C.P,
        serverUrl: C.serverUrl,
        CMD,
        fail,
      });
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
              rows: r.projects.map((p) => ({
                name: p.name,
                root: p.root ?? '',
                entries: p.entries ?? '',
                integrity: p.error ?? p.integrity ?? 'not computed',
              })),
            },
          },
        ],
        r
      );
    },

    async init() {
      const dir = resolve(rest[0] ?? '.');
      let wsRoot = null;
      try {
        const ws = findWorkspace({ cwd: dir });
        if (ws.file) wsRoot = ws.root;
      } catch {
        // no workspace above: a single-package project
      }
      /**
       * @param {string} k
       * @returns {string | null}
       */
      const s = (k) => (typeof flags[k] === 'string' ? flags[k] : null);
      // The dashboard title: --label, else asked once of a person at a terminal setting up a new
      // config (Enter keeps the name). An existing config is never edited: its label is changed there.
      let label = s('label');
      if (
        label == null &&
        !existsSync(join(dir, CONFIG_FILE)) &&
        humanAtTerminal() &&
        format !== 'json'
      ) {
        const name = s('name') ?? basename(dir);
        label = (await ask(`Title in the dashboard (Enter for ${name}): `)) || null;
      }
      const wrote = initProject({
        dir,
        name: s('name'),
        label,
        srcRoot: s('src') ?? 'src',
        storybookUrl: s('storybook-url'),
        storybookConfigDir: s('storybook-config'),
        workspaceRoot: wsRoot,
        layout: s('layout'),
      });
      emit(
        format,
        [
          { h: 'pxsig init', sub: dir },
          wrote.length
            ? { list: wrote.map((p) => relPath(process.cwd(), p) || p) }
            : { note: 'already set up: nothing written' },
          {
            next: [
              [`${CMD} manifest`, 'list the stories to check (Storybook must be running)'],
              [`${CMD} check --full`, 'render and check them'],
            ],
          },
        ],
        { wrote }
      );
    },

    config() {
      const P = openProject({ project: oneProject() });
      const d = describeConfig(P);
      // Warn mode, when the config sets it: each gate's setting, the layer that set it, the days left.
      /** @type {(ReturnType<typeof resolveEnforcement> & { error?: undefined }) | (Partial<ReturnType<typeof resolveEnforcement>> & { error: string }) | null} */
      let enf = null;
      if (P.config.enforcement != null)
        try {
          enf = resolveEnforcement(P, { flags });
        } catch (e) {
          enf = { error: /** @type {Error} */ (e).message };
        }
      if (enf)
        d.enforcement = enf.error
          ? enf
          : {
              gates: enf.gates,
              layers: enf.layers,
              warnUntil: enf.warnUntil,
              daysLeft: enf.daysLeft,
              advisoryExit: enf.advisoryExit,
            };
      if (format === 'json') return process.stdout.write(`${JSON.stringify(d, null, 2)}\n`);
      /**
       * The value at a dotted path of a config.
       * @param {ConfigValue} o
       * @param {string} k
       * @returns {ConfigValue}
       */
      const get = (o, k) =>
        k
          .split('.')
          .reduce((v, x) => (v == null ? v : /** @type {Record<string, ConfigValue>} */ (v)[x]), o);
      /** @param {ConfigValue} v */
      const show = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
      /** @param {string | null | undefined} p */
      const rel = (p) => (p ? relPath(process.cwd(), p) || '.' : '—');
      const rows = Object.keys(d.sources)
        .sort()
        .map((k) => ({
          k,
          v: k === 'modes' ? Object.keys(d.modes).join(', ') : show(get(d.config, k)),
          from: {
            text: d.sources[k],
            color:
              d.sources[k] === 'defaults'
                ? 'gray'
                : d.sources[k] === 'flags' || d.sources[k] === 'env'
                  ? 'yellow'
                  : undefined,
          },
        }));
      emit(
        format,
        [
          { h: 'pxsig config', sub: d.project },
          {
            kv: [
              ['Dashboard title', `pxsig · ${d.label ?? d.project}`],
              ['Workspace file', rel(d.workspaceFile)],
              ['Project config', rel(d.configFile)],
              ['Source root', rel(d.srcRoot)],
              ['Store', `${rel(d.store.root)} (${d.store.layout})`],
              ['Storybook', d.storybook.url],
              ['Binary', rel(d.rustBin)],
            ],
          },
          {
            h: 'Settings',
            sub: 'later layers win: defaults < workspace defaults < project config < env < flags',
          },
          {
            table: {
              cols: [
                { key: 'k', label: 'Key' },
                { key: 'v', label: 'Value' },
                { key: 'from', label: 'Set by' },
              ],
              rows,
            },
          },
          ...(enf
            ? enf.error
              ? [{ h: 'Enforcement' }, { note: enf.error, tone: 'bad' }]
              : [
                  {
                    h: 'Enforcement',
                    sub: `${enf.warnUntil ? `warn until ${enf.warnUntil}${enf.daysLeft != null ? ` (${enf.daysLeft} days left)` : ' (passed)'} · ` : ''}advisory exit ${enf.advisoryExit}`,
                  },
                  {
                    table: {
                      cols: [
                        { key: 'g', label: 'Gate' },
                        { key: 'v', label: 'Setting' },
                        { key: 'from', label: 'Set by' },
                      ],
                      // not the error case (an error's message is never empty): gates and layers are set
                      rows: Object.entries(/** @type {Record<string, string>} */ (enf.gates)).map(
                        ([g, v]) => ({
                          g,
                          v: {
                            text: v,
                            color: v === 'warn' ? 'yellow' : v === 'off' ? 'gray' : undefined,
                          },
                          from: /** @type {Record<string, string>} */ (enf.layers)[g],
                        })
                      ),
                    },
                  },
                ]
            : []),
        ],
        d
      );
    },

    async manifest() {
      const P = openProject({ project: oneProject() });
      const { ensureStorybook } = await import('../lib/static.mjs');
      const sb = await ensureStorybook(P, {
        log: (m) => format !== 'json' && process.stderr.write(`[manifest] ${m}\n`),
      });
      const spin = progress(format, 'reading stories from Storybook');
      let r;
      try {
        r = await buildManifest(P, { suite: typeof flags.suite === 'string' ? flags.suite : null });
      } catch (e) {
        spin.done(/** @type {Error} */ (e).message, false);
        fail(/** @type {Error} */ (e).message, 2);
      } finally {
        if (sb.served) await sb.close();
      }
      spin.done(
        `${r.manifest.stories.length} entries · ${r.added.length} new · ${r.removed.length} removed`
      );
      emit(
        format,
        [
          { h: 'Manifest', sub: relPath(process.cwd(), r.path) },
          {
            kv: [
              ['Entries', String(r.manifest.stories.length)],
              ['New (no baseline yet)', String(r.added.length)],
              ['Removed', String(r.removed.length)],
              ['Skipped', String(r.skipped.length)],
            ],
          },
        ],
        { path: r.path, added: r.added, removed: r.removed, skipped: r.skipped }
      );
    },
  };
}
