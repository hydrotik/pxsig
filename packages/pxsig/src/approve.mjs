/**
 * approve.mjs — the guarded way to accept new baselines in bulk (`pxsig approve …`).
 *
 *   plan  <ids…> | --component x | --all-changed | --new   --reason "why"
 *         [--allow-shape id,id] [--first-baselines]
 *         Classifies each changed entry (lib/shape.mjs): `colour` (content in place) or `shape`
 *         (moved / added / removed / resized). Shape entries are BLOCKED unless named in
 *         --allow-shape; stale verdicts are blocked. `--new` plans NEW entries (no baseline yet,
 *         with a latest render): with nothing to compare they are shape changes, so each needs
 *         --allow-shape, or --first-baselines for all of them. Pins the sha256 of every latest
 *         render and baseline. Writes <store>/reports/approval-plan.json. Safe for anyone, agents included.
 *   apply [plan]
 *         A person at a real terminal only (refused when piped, in CI or under an assistant). Re-hashes
 *         every render and refuses the whole plan if one changed since planning, then asks for the
 *         phrase "APPROVE <n> ENTRIES". Each write is snapshotted and logged by the server.
 *   log [--limit 10] [--trace]
 *                         approvals by batch; --trace adds the commit that added each batch's lines
 *                         and the pull request that merged it (from git; never a name)
 *   undo <batch>          restore a batch's previous baselines (terminal only, typed confirm); from
 *                         the local snapshot, else from git (only bytes matching the logged sha256)
 *   verify [--no-strict] [--since <ref>] [--suite <name> | --all-suites] [--adopt]
 *                         baselines whose bytes differ from their last logged approval, and (strict,
 *                         the default) baselines with no log line at all; --since also fails when the
 *                         log was rewritten rather than appended to; --adopt logs the current
 *                         baselines as the starting point (terminal only). Under warn mode
 *                         (the `verify` gate) only baselines with no log line are warned; a
 *                         mismatch or a rewritten log fails in every mode (decision 10.4)
 *
 * Per-entry approval in the dashboard / Storybook panel stays as it is (one entry, images on
 * screen) and is logged the same way.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendedSince,
  mergeBase,
  newBatch,
  paths,
  readLog,
  record,
  sha256,
  traceLog,
  undo as undoBatch,
  verify,
  who,
} from './lib/approvals.mjs';
import { readToken, TOKEN_HEADER } from './lib/guard.mjs';
import { takeLock } from './lib/lock.mjs';
import { readImage } from './lib/psig.mjs';
import { classify } from './lib/shape.mjs';
import { ask, emit, humanAtTerminal, progress, whyNotPerson } from './lib/term.mjs';
import { relPath } from './lib/paths.mjs';
import { writeJson } from './lib/files.mjs';
import {
  appendReadiness,
  lastLine,
  leadLine,
  outcome,
  reportBlock,
  resolveOrExit,
} from './lib/enforcement.mjs';
/** @import { Flags, LockHandle, Manifest, ManifestEntry, Project } from './types.js' */
/** @import { UndoResult, VerifyResult } from './types/t2.js' */

const PLAN_MAX_AGE_H = 24;

/** What this file reads of each MCP tool's result, by tool. */
/** @typedef {{ list: { entries: { id: string, state: string }[] }, stale: { ids: string[] }, check: unknown }} ToolOutputs */
/**
 * One entry of an approval plan (`approval-plan.json`).
 * @typedef {{ id: string, status: string, why: string, state?: string, latestSha?: string | null, baseSha?: string | null, kind?: string, shape?: string, shapePct?: number | null, first?: true }} PlanEntry
 */

/**
 * `pxsig approve <sub>`: plan, apply, list, undo, verify. The CLI passes its context.
 * `fail` prints the message and exits: it never returns.
 * @param {{ sub: string | undefined, args: string[], flags: Flags, format: string, tools: typeof import('./mcp.mjs').tools, project: Project, serverUrl: string, CMD: string, fail: (message: string, code?: number) => never }} opts
 */
export async function approveCommand({
  sub,
  args,
  flags,
  format,
  tools,
  project: P,
  serverUrl,
  CMD,
  fail,
}) {
  /**
   * @template {keyof ToolOutputs} N
   * @param {N} name
   * @param {Record<string, unknown>} [a]
   */
  const run = (name, a = {}) =>
    // `pxsig_${name}` is one of the tools; ToolOutputs says what is read of its result.
    /** @type {{ run: (args: object) => Promise<ToolOutputs[N]> }} */ (
      /** @type {unknown} */ (tools.find((t) => t.name === `pxsig_${name}`))
    ).run({ project: P.name, ...a });
  // The manifest is pxsig's own (`pxsig index` writes it).
  const manifest = /** @type {Manifest} */ (JSON.parse(readFileSync(P.manifestPath(), 'utf8')));
  const byId = new Map(manifest.stories.map((e) => [e.id, e]));
  const planPath = join(P.store.reports, 'approval-plan.json');
  /** @param {string} p */
  const rel = (p) => relPath(P.workspaceRoot, p);
  /** @param {string} what */
  const needHuman = (what) => {
    if (humanAtTerminal()) return;
    fail(
      `${what} needs a person at a terminal: ${whyNotPerson()}. Run it yourself in a terminal.`,
      3
    );
  };

  if (sub === 'plan') {
    const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
    if (reason.length < 8)
      fail('plan needs --reason "…" (at least a sentence: why these changes are intended)');
    const all = (await run('list', { state: 'all', limit: 100000 }).catch(() => ({ entries: [] })))
      .entries;
    const state = new Map(all.map((e) => [e.id, e.state]));
    // An entry with no baseline and no row yet, but a latest render, is NEW too.
    for (const e of manifest.stories)
      if (!state.has(e.id) && !existsSync(paths(P, e).sig) && existsSync(paths(P, e).latestPng))
        state.set(e.id, 'new');
    /** @param {string} id */
    const isNew = (id) =>
      state.get(id) === 'new' ||
      // `byId.has(id)` just before.
      (byId.has(id) && !existsSync(paths(P, /** @type {ManifestEntry} */ (byId.get(id))).sig));
    let ids = args;
    if (flags.component)
      ids = all
        .filter(
          (e) => e.state === 'changed' && e.id.includes(String(flags.component).toLowerCase())
        )
        .map((e) => e.id);
    else if (flags['all-changed']) ids = all.filter((e) => e.state === 'changed').map((e) => e.id);
    if (flags.new)
      ids = [
        ...new Set([
          ...(flags['all-changed'] || flags.component || args.length ? ids : []),
          ...[...state.keys()].filter(
            (id) => isNew(id) && existsSync(paths(P, byId.get(id) ?? { id, sig: '' }).latestPng)
          ),
        ]),
      ];
    if (!ids.length)
      fail(
        'nothing to plan: name ids, --component <name>, --all-changed or --new (only changed and NEW entries are approvable)'
      );
    const firstBaselines = !!flags['first-baselines'];
    const allowShape = new Set(
      typeof flags['allow-shape'] === 'string'
        ? flags['allow-shape'].split(',').map((s) => s.trim())
        : []
    );
    const stale = new Set(
      // The fallback `{}` has no ids.
      /** @type {{ ids?: string[] }} */ (await run('stale', { limit: 100000 }).catch(() => ({})))
        .ids ?? []
    );
    const spin = progress(format, `classifying ${ids.length} entries`);
    /** @type {PlanEntry[]} */
    const entries = [];
    for (const id of ids) {
      const e = byId.get(id);
      const st = state.get(id);
      if (!e) {
        entries.push({ id, status: 'blocked', why: 'unknown entry' });
        continue;
      }
      const p = paths(P, e);
      const baseImg = readImage(p.sig);
      const base = { id, state: st, latestSha: sha256(p.latestPng), baseSha: sha256(p.sig) };
      const fresh = isNew(id) && !base.baseSha;
      if (st !== 'changed' && !fresh)
        entries.push({ ...base, status: 'blocked', why: `state is ${st}, not changed or new` });
      else if (!base.latestSha)
        entries.push({ ...base, status: 'blocked', why: 'no latest render' });
      else if (stale.has(id))
        entries.push({ ...base, status: 'blocked', why: 'verdict is stale: re-check first' });
      else {
        /** @type {{ kind: string, reason: string, shapePct?: number | null }} */
        const c = baseImg
          ? classify(baseImg, p.latestPng)
          : {
              kind: 'shape',
              reason: base.baseSha
                ? 'the baseline has no image to compare'
                : 'no baseline yet (a first baseline)',
            };
        const allowed = c.kind === 'colour' || allowShape.has(id) || (fresh && firstBaselines);
        entries.push({
          ...base,
          kind: c.kind,
          shape: c.reason,
          shapePct: c.shapePct ?? null,
          status: allowed ? 'ok' : 'blocked',
          first: fresh || undefined,
          why: allowed
            ? c.kind === 'shape'
              ? allowShape.has(id)
                ? `allowed by name: ${c.reason}`
                : 'first baseline, allowed by --first-baselines'
              : ''
            : `${c.reason}: review it, then name it in --allow-shape${fresh ? ' (or pass --first-baselines)' : ''}`,
        });
      }
    }
    const ok = entries.filter((e) => e.status === 'ok');
    spin.done(`classified ${entries.length} entries`);
    const plan = {
      version: 1,
      createdAt: new Date().toISOString(),
      ...(who(P.workspaceRoot, P.config) ? { by: who(P.workspaceRoot, P.config) } : {}),
      project: P.name,
      reason,
      entries,
    };
    writeJson(planPath, plan, { pretty: true });
    /** @param {string} k */
    const n = (k) => entries.filter((e) => e.kind === k).length;
    emit(
      format,
      [
        { h: 'Approval plan', sub: `${ok.length} ready · ${entries.length - ok.length} blocked` },
        {
          kv: [
            ['Reason', reason],
            ['Colour only', String(n('colour'))],
            ['Shape changes', String(n('shape'))],
            ['First baselines', String(entries.filter((e) => e.first).length)],
            ['Written', rel(planPath)],
          ],
        },
        {
          table: {
            cols: [
              { key: 'st', label: 'Plan' },
              { key: 'id', label: 'Entry' },
              { key: 'kind', label: 'Change' },
              { key: 'why', label: 'Note' },
            ],
            rows: entries
              .sort((a, b) => (a.status === b.status ? 0 : a.status === 'blocked' ? -1 : 1))
              .slice(0, 60)
              .map((e) => ({
                st:
                  e.status === 'ok'
                    ? { text: '✓ ok', color: 'green' }
                    : { text: '✗ blocked', color: 'red' },
                id: e.id,
                kind: e.kind ?? '',
                why: e.why || e.shape || '',
              })),
            more: Math.max(0, entries.length - 60),
          },
        },
        {
          next: [
            ...(entries.some((e) => e.kind === 'shape' && e.status === 'blocked')
              ? [
                  /** @type {[string, string]} */ ([
                    `${CMD} entry <id>`,
                    'look at each blocked shape change; re-plan with --allow-shape <ids> for the intended ones',
                  ]),
                ]
              : []),
            ...(ok.length
              ? [
                  /** @type {[string, string]} */ ([
                    `${CMD} approve apply`,
                    `a person, in a terminal: approve the ${ok.length} ready entries`,
                  ]),
                ]
              : []),
          ],
        },
      ],
      plan
    );
    return;
  }

  if (sub === 'apply') {
    needHuman('approve apply');
    const file = args[0] ?? planPath;
    if (!existsSync(file)) fail(`no plan at ${rel(file)}: run \`${CMD} approve plan\` first`);
    // A plan `approve plan` wrote (the hashes below refuse one that does not match the store).
    const plan = /** @type {{ createdAt: string, reason: string, entries: PlanEntry[] }} */ (
      JSON.parse(readFileSync(file, 'utf8'))
    );
    const ageH = (Date.now() - Date.parse(plan.createdAt)) / 3.6e6;
    if (ageH > PLAN_MAX_AGE_H)
      fail(`the plan is ${ageH.toFixed(0)} h old (max ${PLAN_MAX_AGE_H}): plan again`);
    const ok = plan.entries.filter((e) => e.status === 'ok');
    if (!ok.length) fail('the plan has no ready entries');
    // Pin: what is approved must be byte-for-byte what was planned.
    const drifted = ok.filter((e) => {
      // An id the manifest no longer has fails here (a TypeError): see the report.
      const p = paths(P, /** @type {ManifestEntry} */ (byId.get(e.id)));
      return sha256(p.latestPng) !== e.latestSha || sha256(p.sig) !== e.baseSha;
    });
    if (drifted.length)
      fail(
        `${drifted.length} renders or baselines changed since planning (${drifted
          .slice(0, 3)
          .map((e) => e.id)
          .join(', ')}…): plan again`
      );
    // The server's status (docs/server.md): only these two keys are read.
    const status = /** @type {{ running?: unknown, queued?: unknown } | null} */ (
      await fetch(`${serverUrl}/__pxsig/status`, { signal: AbortSignal.timeout(3000) })
        .then((r) => r.json())
        .catch(() => null)
    );
    if (!status)
      fail(`the pxsig server is not running (${serverUrl}): start it with \`${CMD} serve\``);
    // `fail` exits when there is no status (TypeScript cannot see that through a parameter).
    if (
      /** @type {NonNullable<typeof status>} */ (status).running ||
      /** @type {NonNullable<typeof status>} */ (status).queued
    )
      fail('a check is running: wait for it, then plan again');
    // The server refuses decisions without its token (lib/guard.mjs); this path read it only after
    // the person-at-a-terminal check above.
    const token = readToken(P.workspaceRoot, serverUrl);
    if (!token)
      fail(
        `no token from the pxsig server at ${serverUrl} (it writes one when it starts): restart \`${CMD} serve\` with this version`
      );
    const shape = ok.filter((e) => e.kind === 'shape' && !e.first);
    const first = ok.filter((e) => e.first);
    process.stdout.write(
      `\nApprove ${ok.length} baselines (${ok.length - shape.length - first.length} colour only, ${shape.length} shape changes allowed by name, ${first.length} first baselines).\nReason: ${plan.reason}\n`
    );
    if (first.length)
      process.stdout.write(
        `First baselines (nothing to compare them with): ${first.map((e) => e.id).join(', ')}\n`
      );
    if (shape.length) process.stdout.write(`Shape changes: ${shape.map((e) => e.id).join(', ')}\n`);
    const phrase = `APPROVE ${ok.length} ENTRIES`;
    const typed = await ask(`Type "${phrase}" to continue: `);
    if (typed !== phrase) fail('not confirmed: nothing was written', 1);
    const batch = newBatch('cli');
    const spin = progress(format, `approving ${ok.length}`);
    let done = 0;
    for (const e of ok) {
      const r = await fetch(`${serverUrl}/__pxsig/approve`, {
        method: 'POST',
        // `fail` above exits when there is no token.
        headers: {
          'content-type': 'application/json',
          [TOKEN_HEADER]: /** @type {string} */ (token),
        },
        body: JSON.stringify({
          project: P.name,
          id: e.id,
          batch,
          via: 'cli',
          reason: plan.reason,
          kind: e.kind,
        }),
      });
      if (!r.ok) {
        spin.done(
          // The server's refusal (docs/server.md): `{ error }`.
          `stopped at ${e.id}: ${/** @type {{ error?: string }} */ (await r.json().catch(() => ({}))).error ?? r.status}`,
          false
        );
        fail(`approved ${done} of ${ok.length}; undo with \`${CMD} approve undo ${batch}\``, 1);
      }
      spin.update(`approving ${++done}/${ok.length}`);
    }
    spin.done(`approved ${done} entries · batch ${batch}`);
    writeJson(file, { ...plan, appliedAt: new Date().toISOString(), batch }, { pretty: true });
    emit(
      format,
      [
        { h: 'Approved', sub: `${done} entries` },
        {
          kv: [
            ['Batch', batch],
            ['Log', rel(P.store.approvals)],
          ],
        },
        {
          next: [
            [`${CMD} approve undo ${batch}`, 'restore the previous baselines'],
            [`${CMD} check --all`, 'confirm everything passes'],
          ],
        },
      ],
      { batch, approved: done }
    );
    return;
  }

  if (sub === 'log') {
    const log = readLog(P);
    // --trace (decision 82): the commit that added a batch's lines and the PR that merged it, from
    // git. pxsig points at the trail; it shows no names (the commit and the PR say who).
    const trace = flags.trace ? traceLog(P) : null;
    if (flags.trace && !trace)
      fail('approve log --trace needs the approval log in a git repository', 2);
    /** @type {Map<string, { commits: Set<string>, prs: Set<string> }>} */
    const where = new Map();
    for (const t of trace ?? []) {
      const w = where.get(t.batch) ?? { commits: new Set(), prs: new Set() };
      w.commits.add(t.commit ?? 'not committed');
      if (t.pr) w.prs.add(`#${t.pr}`);
      where.set(t.batch, w);
    }
    /** @type {Map<string, { batch: string, at: string, by?: string | null, via: string, reason?: string | null, n: number, commit?: string, pr?: string }>} */
    const batches = new Map();
    for (const l of log) {
      const b = batches.get(l.batch) ?? {
        batch: l.batch,
        at: l.at,
        by: l.by,
        via: l.via,
        reason: l.reason,
        n: 0,
      };
      b.n++;
      batches.set(l.batch, b);
    }
    if (trace)
      for (const b of batches.values()) {
        const w = where.get(b.batch);
        b.commit = w ? [...w.commits].join(', ') : 'not committed';
        b.pr = w?.prs.size ? [...w.prs].join(', ') : '';
        delete b.by;
      }
    const rows = [...batches.values()].reverse().slice(0, Number(flags.limit) || 10);
    emit(
      format,
      [
        { h: 'Approvals', sub: `${log.length} entries in ${batches.size} batches` },
        rows.length
          ? {
              table: {
                cols: [
                  { key: 'at', label: 'When' },
                  { key: 'via', label: 'Via' },
                  { key: 'n', label: 'Entries', right: true },
                  ...(trace
                    ? [
                        { key: 'commit', label: 'Commit' },
                        { key: 'pr', label: 'PR' },
                      ]
                    : [{ key: 'by', label: 'By' }]),
                  { key: 'reason', label: 'Reason' },
                  { key: 'batch', label: 'Batch' },
                ],
                rows: rows.map((b) => ({
                  ...b,
                  at: b.at.replace('T', ' ').slice(0, 19),
                  reason: b.reason ?? '',
                })),
              },
            }
          : { note: 'No approvals logged yet.' },
      ],
      rows
    );
    return;
  }

  if (sub === 'undo') {
    needHuman('approve undo');
    const batch = args[0] ?? fail('usage: approve undo <batch>  (see `approve log`)');
    const typed = await ask(
      `Restore the baselines batch ${batch} replaced? Type "UNDO" to continue: `
    );
    if (typed !== 'UNDO') fail('not confirmed: nothing was restored', 1);
    let lock;
    try {
      lock = await takeLock(P, { holder: 'approve undo' });
      lock.check();
    } catch (e) {
      // takeLock throws Errors: a LockError (with `exit` when it needs a person), or the fs error.
      fail(
        `${/** @type {Error} */ (e).message}. Undo writes baselines, so it needs the store to itself.`,
        /** @type {{ exit?: number }} */ (e).exit ?? 2
      );
    }
    const before = new Map(manifest.stories.map((e) => [e.id, sha256(paths(P, e).sig)]));
    let res;
    try {
      res = undoBatch(P, manifest, batch);
    } catch (e) {
      /** @type {LockHandle} */ (lock).release();
      // undo throws Errors (no snapshot, no log line, an fs error).
      fail(/** @type {Error} */ (e).message, 2);
    }
    // `fail` exits (it never returns), which TypeScript cannot see through a destructured
    // parameter: past the two `try`s, `lock` and `res` are set, and the casts say so.
    for (const id of [
      .../** @type {UndoResult} */ (res).restored,
      .../** @type {UndoResult} */ (res).removed,
    ])
      // Ids undo restored or removed come from the manifest (`undo` refuses any other).
      record(P, /** @type {ManifestEntry} */ (byId.get(id)), {
        batch: `${batch}-undo`,
        via: 'undo',
        reason: `undo ${batch}${/** @type {UndoResult} */ (res).source === 'git' ? ' (from git)' : ''}`,
        before: before.get(id) ?? null,
      });
    /** @type {LockHandle} */ (lock).release();
    if (/** @type {UndoResult} */ (res).restored.length)
      await run('check', { ids: /** @type {UndoResult} */ (res).restored }).catch(() => null);
    emit(
      format,
      [
        {
          h: 'Restored',
          sub: `${/** @type {UndoResult} */ (res).restored.length} baselines from ${batch} (${/** @type {UndoResult} */ (res).source === 'git' ? 'git history' : 'local snapshot'})${/** @type {UndoResult} */ (res).removed.length ? ` · ${/** @type {UndoResult} */ (res).removed.length} first baselines moved to trash/` : ''}`,
        },
        /** @type {UndoResult} */ (res).refused.length
          ? { h: 'Refused' }
          : {
              note: /** @type {UndoResult} */ (res).restored.length
                ? 'Re-checked against the restored baselines.'
                : 'Nothing to re-check.',
            },
        /** @type {UndoResult} */ (res).refused.length
          ? { list: /** @type {UndoResult} */ (res).refused.map((r) => `${r.id} — ${r.why}`) }
          : {},
      ],
      res
    );
    if (/** @type {UndoResult} */ (res).refused.length) process.exit(1);
    return;
  }

  if (sub === 'verify') {
    // Which manifests: the main one, one suite, or every suite (a suite whose manifest is not in
    // this checkout, such as a git-ignored matrix suite, is listed as not committed, not failed).
    const suiteNames = Object.keys(P.config.suites ?? {});
    if (typeof flags.suite === 'string' && !suiteNames.includes(flags.suite))
      fail(`unknown suite "${flags.suite}" (suites: ${suiteNames.join(', ') || 'none'})`, 2);
    const suites = flags['all-suites']
      ? ['', ...suiteNames]
      : typeof flags.suite === 'string'
        ? [flags.suite]
        : [''];
    /** @param {string} s */
    const suiteArg = (s) => (s ? ` --suite ${s}` : '');
    /**
     * @param {string} s
     * @returns {Manifest | null}
     */
    const load = (s) => {
      const path = P.manifestPath(s || null);
      // A manifest is pxsig's own (`pxsig index` writes it).
      return existsSync(path)
        ? /** @type {Manifest} */ (JSON.parse(readFileSync(path, 'utf8')))
        : null;
    };

    if (flags.adopt) {
      needHuman('approve verify --adopt');
      // The filter drops the suites with no manifest.
      const sets = /** @type {[string, Manifest][]} */ (
        suites.map((s) => [s, load(s)]).filter(([, m]) => m)
      );
      const n = sets.reduce((k, [, m]) => k + m.stories.length, 0);
      const drifted = sets.reduce((k, [, m]) => k + verify(P, m).mismatched.length, 0);
      const typed = await ask(
        `Log the ${n} current baselines as the trusted starting point? Type "ADOPT" to continue: `
      );
      if (typed !== 'ADOPT') fail('not confirmed', 1);
      try {
        (await takeLock(P, { holder: 'approve verify --adopt' })).check();
      } catch (e) {
        // takeLock throws Errors: a LockError (with `exit` when it needs a person), or the fs error.
        fail(/** @type {Error} */ (e).message, /** @type {{ exit?: number }} */ (e).exit ?? 2);
      }
      const batch = newBatch('adopt');
      for (const [, m] of sets)
        for (const e of m.stories)
          record(P, e, {
            batch,
            via: 'adopt',
            reason: 'adopt current baselines as the starting point',
            before: null,
          });
      emit(
        format,
        [{ h: 'Adopted', sub: `${n} baselines logged (${drifted} had drifted from their log)` }],
        { batch }
      );
      return;
    }

    // Strict by default (decision 6.1h): a baseline with no log line fails. --no-strict reports it only.
    const strict = !flags['no-strict'];
    const enf = resolveOrExit(P, { flags }, (m, code) => fail(m, code));
    /** @type {(VerifyResult & { suite: string })[]} */
    const results = [];
    /** @type {string[]} */
    const notCommitted = [];
    for (const s of suites) {
      const m = load(s);
      if (!m) notCommitted.push(s);
      else results.push({ suite: s, ...verify(P, m) });
    }
    if (!results.length)
      fail(
        `no manifest to verify${notCommitted.length ? ` (not in this checkout: ${notCommitted.map((s) => s || 'main').join(', ')})` : ''}`,
        2
      );
    // --since: the log at the merge base must be a byte prefix of today's (append-only). With no
    // merge base this gate cannot verify, and that is a failure here.
    /** @type {{ since: string, base: string | null, why?: string, rewritten?: boolean, appended?: number } | null} */
    let range = null;
    if (typeof flags.since === 'string') {
      const mb = mergeBase(P.store.root, flags.since);
      if (mb.error) fail(mb.error, 2);
      if (!mb.base) range = { since: flags.since, base: null, why: mb.why };
      else {
        const a = appendedSince(P, mb.base);
        range = {
          since: flags.since,
          base: mb.base,
          rewritten: a.rewritten,
          appended: a.lines.length,
        };
      }
    }
    /** @param {'mismatched' | 'untracked'} k */
    const sum = (k) =>
      results.reduce(
        (n, r) =>
          n +
          // `mismatched` is a list, `untracked` a count.
          (Array.isArray(r[k]) ? /** @type {unknown[]} */ (r[k]).length : r[k]),
        0
      );
    const bad = sum('mismatched');
    const untracked = sum('untracked');
    const interrupted = results.flatMap((r) => r.interrupted);
    const cut = [...new Set(interrupted.map((x) => x.batch))];
    const torn = Math.max(...results.map((r) => r.torn));
    const logged = Math.max(...results.map((r) => r.logged));
    const failUntracked = strict && untracked > 0;
    const rangeBad = range && (!range.base || range.rewritten);
    /** @param {{ suite: string }} r */
    const adoptCmd = (r) => `${CMD} approve verify --adopt${suiteArg(r.suite)}`;
    const missing = results.filter((r) => r.untracked);
    // Warn mode: only the untracked baselines can be warned; the rest fails in every mode (10.4).
    const gated = outcome(enf, [
      {
        gate: 'verify',
        exit: failUntracked ? 1 : 0,
        count: untracked,
        what: untracked === 1 ? 'baseline without a log line' : 'baselines without a log line',
      },
      ...(bad
        ? [{ gate: null, exit: 1, count: bad, what: 'differ from their logged approval' }]
        : []),
      ...(interrupted.length
        ? [
            {
              gate: null,
              exit: 1,
              count: interrupted.length,
              what: 'written by an interrupted approval',
            },
          ]
        : []),
      ...(rangeBad
        ? [
            {
              gate: null,
              exit: 1,
              count: 1,
              // `rangeBad` is only true with a range.
              what: /** @type {NonNullable<typeof range>} */ (range).base
                ? 'rewritten log'
                : 'range without a merge base',
            },
          ]
        : []),
    ]);
    const lead = leadLine(enf);
    const last = lastLine(enf, gated);
    appendReadiness(P, enf, gated, {
      source: 'verify',
      counts: { verify: untracked + bad + interrupted.length },
    });
    emit(
      format,
      [
        lead ? { note: lead, tone: 'warn' } : {},
        {
          h: 'Baseline integrity',
          sub: `${logged} logged · ${untracked} baselines without a log entry${results.length > 1 || suites[0] ? ` · ${results.map((r) => r.suite || 'main').join(', ')}` : ''}`,
        },
        notCommitted.length
          ? {
              note: `Not in this checkout, not verified: ${notCommitted.map((s) => `suite ${s}`).join(', ')} (its manifest is not committed).`,
            }
          : {},
        range && !range.base
          ? { note: `Cannot verify the log since ${range.since}: ${range.why}.`, tone: 'bad' }
          : {},
        range?.rewritten
          ? {
              note: `approvals.ndjson was rewritten since ${range.since}, not appended to: lines were removed or changed. The log is append-only; restore the lines from ${range.since} and add new ones after them.`,
              tone: 'bad',
            }
          : {},
        range?.base && !range.rewritten
          ? {
              note: `${range.appended} log lines added since ${range.since}; the rest is unchanged.`,
            }
          : {},
        torn
          ? {
              note: `${torn} line(s) of the approval log were cut short (a crash mid-write) and are left out: \`${CMD} doctor --repair --only log-torn\` removes them`,
              tone: 'warn',
            }
          : {},
        interrupted.length
          ? {
              note: `${interrupted.length} baselines were written by an approval that stopped before logging them (batch ${cut.join(', ')}): undo it, or approve those entries again`,
              tone: 'warn',
            }
          : {},
        interrupted.length
          ? {
              next: cut.map((batch) => [
                `${CMD} approve undo ${batch}`,
                'put back the baselines it replaced',
              ]),
            }
          : {},
        bad
          ? {
              note: `${bad} baselines differ from their last logged approval: written outside the trail${results.some((r) => r.mismatched.some((x) => x.older)) ? `. ${results.flatMap((r) => r.mismatched).filter((x) => x.older).length} of them were last logged by an older pxsig (the Logged by column): if a teammate still runs it, they upgrade pxsig and approve those entries again` : ''}`,
              tone: 'bad',
            }
          : {},
        bad
          ? {
              table: {
                cols: [
                  { key: 'id', label: 'Entry' },
                  { key: 'logged', label: 'Logged' },
                  { key: 'now', label: 'Now' },
                  { key: 'by', label: 'Logged by' },
                ],
                rows: results
                  .flatMap((r) => r.mismatched)
                  .slice(0, 40)
                  .map((x) => ({
                    ...x,
                    by: x.writtenBy ? `pxsig ${x.writtenBy}` : 'pxsig before 0.4',
                  })),
              },
            }
          : {},
        untracked
          ? {
              note: failUntracked
                ? `${untracked} baselines have no approval log line, so nothing records that a person approved them: ${missing
                    .flatMap((r) => r.untrackedIds)
                    .slice(0, 10)
                    .join(
                      ', '
                    )}${untracked > 10 ? ` and ${untracked - 10} more` : ''}. Baselines from before pxsig kept a log are adopted once, by a person; any other is a baseline written outside the trail. (\`--no-strict\` reports these without failing.)`
                : `${untracked} baselines have no approval log line (not a failure with --no-strict).`,
              tone: failUntracked ? 'bad' : 'warn',
            }
          : {},
        untracked
          ? {
              next: missing.map((r) => [
                adoptCmd(r),
                'a person, in a terminal: log the current baselines as the starting point',
              ]),
            }
          : {},
        !bad && !interrupted.length && !untracked && !rangeBad
          ? {
              note: logged ? 'Every baseline matches its approval.' : 'No baselines to verify.',
              tone: logged ? 'ok' : undefined,
            }
          : {},
        last ? { note: last, tone: gated.advisory ? 'warn' : undefined } : {},
      ],
      {
        strict,
        suites: results.map(({ untrackedIds, ...r }) => r),
        notCommitted,
        range,
        ...(results.length === 1 ? (({ untrackedIds, suite, ...r }) => r)(results[0]) : {}),
        ...(reportBlock(enf, gated) ? { enforcement: reportBlock(enf, gated) } : {}),
      }
    );
    process.exit(gated.exit);
  }

  fail(
    `usage: approve plan | apply | log [--trace] | undo <batch> | verify [--no-strict] [--since <ref>] [--suite <name> | --all-suites] [--adopt]`
  );
}
