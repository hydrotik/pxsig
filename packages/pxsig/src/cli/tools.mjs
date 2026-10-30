/**
 * cli/tools.mjs — `serve` (with `serveLink`), `mcp`, `report`, `snapshot`, `cat`, `migrate`, `setup`,
 * `browser`, `dashboard`, `help`.
 */
import { spawn, spawnSync } from '../lib/spawn.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { helpBlocks, helpData, helpIndex, lookup, nearestNames } from '../help.mjs';
import { takeLock } from '../lib/lock.mjs';
import { migrateLegacy } from '../lib/setup.mjs';
import { findWorkspace, openProject, rustBinary, serverUrlFor } from '../lib/workspace.mjs';
import { readToken, TOKEN_HEADER } from '../lib/guard.mjs';
import { ask, emit, humanAtTerminal, whyNotPerson } from '../lib/term.mjs';
import { relPath } from '../lib/paths.mjs';

/** @import { Block, CliError } from '../types/t6.js' */
/** @import { CliContext } from './context.mjs' */

/** @param {CliContext} cli */
export function toolCommands(cli) {
  const { flags, positional, format, command, rest, CMD, here, project, list, oneProject } = cli;
  /** @type {CliContext['fail']} */
  const fail = cli.fail;

  /**
   * `pxsig serve --link`: a fresh dashboard link from the running server, for a person at this
   * terminal. The server answers only the CLI's token; the link is printed, never logged.
   */
  async function serveLink() {
    if (!humanAtTerminal())
      fail(
        `the dashboard link is for a person: run \`pxsig serve --link\` yourself in a terminal (${whyNotPerson()})`,
        3
      );
    const ws = findWorkspace({});
    const url = serverUrlFor(ws.root);
    const token = readToken(ws.root, url);
    if (!token)
      fail(
        `no pxsig server is running for this workspace (${url}): start it with \`${CMD} serve\``
      );
    let r;
    try {
      r = await fetch(`${url}/__pxsig/ticket`, {
        method: 'POST',
        headers: { [TOKEN_HEADER]: token },
      });
    } catch {
      fail(`the pxsig server at ${url} does not answer: start it with \`${CMD} serve\``);
    }
    // `POST /__pxsig/ticket`'s answer: the link, or `error`
    const body = /** @type {{ link?: string, error?: string }} */ (
      await r.json().catch(() => ({}))
    );
    if (!r.ok)
      fail(
        `the pxsig server at ${url} refused: ${body.error ?? r.status} (restart \`${CMD} serve\` with this version)`
      );
    process.stdout.write(`${body.link}\n`);
    process.stderr.write(
      'Open it once, within two minutes: that browser can then approve from the dashboard until the server stops.\n'
    );
  }

  return {
    async serve() {
      if (flags.link) return serveLink();
      const pass = process.argv.slice(3);
      const child = spawn(process.execPath, [join(here, 'serve.mjs'), ...pass], {
        stdio: 'inherit',
      });
      child.on('exit', (c) => process.exit(c ?? 0));
      // `kill <pid>` (a process manager, a script) stops the server too, not only this wrapper: an
      // orphaned server kept its port, its store lock and its record in server.json. Ctrl+C reaches
      // the whole process group by itself.
      for (const sig of /** @type {NodeJS.Signals[]} */ (['SIGTERM', 'SIGHUP']))
        process.on(sig, () => child.kill(sig));
    },

    mcp() {
      spawn(process.execPath, [join(here, 'mcp.mjs')], { stdio: 'inherit' }).on('exit', (c) =>
        process.exit(c ?? 0)
      );
    },

    report() {
      const r = spawnSync(process.execPath, [join(here, 'report.mjs'), ...process.argv.slice(3)], {
        stdio: 'inherit',
      });
      process.exit(r.status ?? 2);
    },

    async snapshot() {
      // Reads only the committed store and git: every project by default, as a Storybook may hold several.
      const { buildSnapshot, snapshotCounts } = await import('../snapshot.mjs');
      const ws = findWorkspace({});
      const names = project ? list(project) : ws.projects.map((p) => p.name);
      const unknown = names.filter((n) => !ws.projects.some((p) => p.name === n));
      if (unknown.length)
        fail(
          `no project ${unknown.join(', ')} in this workspace (${ws.projects.map((p) => p.name).join(', ')})`
        );
      const snap = buildSnapshot(names.map((name) => openProject({ project: name })));
      if (typeof flags.out !== 'string')
        return void process.stdout.write(`${JSON.stringify(snap)}\n`);
      const out = resolve(flags.out);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(snap)}\n`);
      const n = snapshotCounts(snap);
      emit(
        format,
        [
          {
            note: `snapshot: ${n.stories} stories, ${n.entries} entries, ${n.projects} project${n.projects === 1 ? '' : 's'} → ${relPath(process.cwd(), out)}`,
            tone: 'ok',
          },
          ...(snap.shallow
            ? [{ note: 'shallow clone: no PR is shown (fetch with fetch-depth: 0)', tone: 'warn' }]
            : []),
        ],
        { out, commit: snap.commit, shallow: snap.shallow, uncommitted: snap.uncommitted, ...n }
      );
    },

    cat() {
      const r = spawnSync(rustBinary(), ['cat', ...process.argv.slice(3)], { stdio: 'inherit' });
      process.exit(r.status ?? 2);
    },

    async migrate() {
      const from =
        typeof flags.from === 'string'
          ? flags.from
          : fail('usage: migrate --from <legacy pxsig folder> [--apply]');
      const P = openProject({ project: oneProject() });
      let lock = null;
      if (flags.apply)
        try {
          lock = await takeLock(P, { holder: 'migrate' });
          lock.check();
        } catch (e) {
          fail(/** @type {Error} */ (e).message, /** @type {CliError} */ (e).exit ?? 2);
        }
      let plan;
      try {
        plan = migrateLegacy(P, {
          from,
          apply: !!flags.apply,
          verify: !flags['no-verify'],
          log: (m) => format !== 'json' && process.stderr.write(`[migrate] ${m}\n`),
        });
      } finally {
        lock?.release();
      }
      /** @type {Block[]} */
      const blocks = [
        {
          h: flags.apply ? 'Migrated' : 'Migration plan (dry run)',
          sub: `${relPath(process.cwd(), plan.from)} → ${relPath(process.cwd(), plan.to)}`,
        },
        {
          kv: [
            ['Baselines', `${plan.summary.baselines} (${plan.summary.withImage} with an image)`],
            ['Manifests', plan.summary.manifests.join(' · ')],
            ['Files copied', String(plan.summary.copies)],
            ['Approvals trail', plan.summary.approvals ? 'carried over' : 'none'],
            ['Problems', String(plan.summary.problems)],
          ],
        },
      ];
      if (plan.problems.length)
        blocks.push({ h: 'Problems' }, { list: plan.problems.slice(0, 20) });
      if (plan.verify)
        blocks.push(
          { h: 'Verification' },
          {
            list: plan.verify.map(
              (v) =>
                `${v.suite ?? 'main'}: ${v.entries} entries · pass ${v.passOld} → ${v.passNew} · ${v.differ} differ${v.differ ? `: ${v.sample.join(', ')}` : ''}`
            ),
          }
        );
      if (!flags.apply)
        blocks.push({
          next: [
            [`${CMD} migrate --from ${from} --apply`, 'run it (the legacy folder is only read)'],
          ],
        });
      const { pack: _pack, manifests, ...json } = plan;
      emit(format, blocks, {
        ...json,
        manifests: manifests.map(({ manifest: _manifest, ...m }) => m),
      });
      if (plan.problems.length || plan.verify?.some((v) => v.differ)) process.exit(1);
    },

    async setup() {
      const { setupCommand } = await import('../setup.mjs');
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
        fail(/** @type {Error} */ (e).message, /** @type {CliError} */ (e).exit ?? 2);
      }
      emit(format, r.blocks, r.data);
      process.exit(r.exit);
    },

    async browser() {
      const { browserCommand } = await import('../browser.mjs');
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
        fail(/** @type {Error} */ (e).message, /** @type {CliError} */ (e).exit ?? 2);
      }
      emit(format, r.blocks, r.data);
      process.exit(r.exit);
    },

    async dashboard() {
      const { dashboardCommand } = await import('../dashboard.mjs');
      process.exitCode = await dashboardCommand(rest[0], { ...flags, json: format === 'json' });
    },

    help() {
      // `pxsig help <name>` and `pxsig <command> [sub] --help`: one page. Alone: the index.
      const words = command === 'help' ? rest : flags.help ? positional : [];
      if (words.length) {
        // `pxsig list changed --help`: the word after a command is an argument, not a subcommand.
        const found = lookup(words) ?? (command !== 'help' ? lookup(words.slice(0, 1)) : null);
        if (!found)
          fail(
            `no command, topic or setting "${words.join(' ')}" — nearest: ${nearestNames(words.join(' ')).join(', ')}`
          );
        return emit(format, helpBlocks(found, CMD), helpData(found));
      }
      const index = helpIndex(CMD);
      emit(format, index.blocks, index.data);
    },
  };
}
