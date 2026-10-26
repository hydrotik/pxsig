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
 *         A person at a real terminal only (refused when piped, in CI or under an agent). Re-hashes
 *         every render and refuses the whole plan if one changed since planning, then asks for the
 *         phrase "APPROVE <n> ENTRIES". Each write is snapshotted and logged by the server.
 *   log [--limit 10]      approvals by batch
 *   undo <batch>          restore a batch's previous baselines (terminal only, typed confirm); from
 *                         the local snapshot, else from git (only bytes matching the logged sha256)
 *   verify [--adopt]      baselines whose bytes differ from their last logged approval;
 *                         --adopt logs the current baselines as the starting point (terminal only)
 *
 * Per-entry approval in the dashboard / Storybook panel stays as it is (one entry, images on
 * screen) and is logged the same way.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  newBatch,
  paths,
  readLog,
  record,
  sha256,
  undo as undoBatch,
  verify,
  who,
} from './lib/approvals.mjs';
import { readToken, TOKEN_HEADER } from './lib/guard.mjs';
import { acquireLock } from './lib/lock.mjs';
import { readImage } from './lib/psig.mjs';
import { classify } from './lib/shape.mjs';
import { ask, emit, humanAtTerminal, progress } from './lib/term.mjs';
import { relPath } from './lib/paths.mjs';

const PLAN_MAX_AGE_H = 24;

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
  const run = (name, a = {}) => tools.find((t) => t.name === `pxsig_${name}`).run({ project: P.name, ...a });
  const manifest = JSON.parse(readFileSync(P.manifestPath(), 'utf8'));
  const byId = new Map(manifest.stories.map((e) => [e.id, e]));
  const planPath = join(P.store.reports, 'approval-plan.json');
  const rel = (p) => relPath(P.workspaceRoot, p);
  const needHuman = (what) => {
    if (humanAtTerminal()) return;
    fail(
      `${what} needs a person at a terminal: it is refused when output is piped, in CI, or under an agent (Claude Code, Codex). Run it yourself in a terminal.`,
      3
    );
  };

  if (sub === 'plan') {
    const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
    if (reason.length < 8)
      fail('plan needs --reason "…" (at least a sentence: why these changes are intended)');
    const all = (await run('list', { state: 'all', limit: 100000 }).catch(() => ({ entries: [] }))).entries;
    const state = new Map(all.map((e) => [e.id, e.state]));
    // An entry with no baseline and no row yet, but a latest render, is NEW too.
    for (const e of manifest.stories) if (!state.has(e.id) && !existsSync(paths(P, e).sig) && existsSync(paths(P, e).latestPng)) state.set(e.id, 'new');
    const isNew = (id) => state.get(id) === 'new' || (byId.has(id) && !existsSync(paths(P, byId.get(id)).sig));
    let ids = args;
    if (flags.component)
      ids = all
        .filter(
          (e) => e.state === 'changed' && e.id.includes(String(flags.component).toLowerCase())
        )
        .map((e) => e.id);
    else if (flags['all-changed']) ids = all.filter((e) => e.state === 'changed').map((e) => e.id);
    if (flags.new) ids = [...new Set([...(flags['all-changed'] || flags.component || args.length ? ids : []), ...[...state.keys()].filter((id) => isNew(id) && existsSync(paths(P, byId.get(id) ?? { id, sig: '' }).latestPng))])];
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
    const stale = new Set((await run('stale', { limit: 100000 }).catch(() => ({}))).ids ?? []);
    const spin = progress(format, `classifying ${ids.length} entries`);
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
        const c = baseImg
          ? classify(baseImg, p.latestPng)
          : { kind: 'shape', reason: base.baseSha ? 'the baseline has no image to compare' : 'no baseline yet (a first baseline)' };
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
      by: who(P.workspaceRoot),
      project: P.name,
      reason,
      entries,
    };
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
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
                  [
                    `${CMD} entry <id>`,
                    'look at each blocked shape change; re-plan with --allow-shape <ids> for the intended ones',
                  ],
                ]
              : []),
            ...(ok.length
              ? [
                  [
                    `${CMD} approve apply`,
                    `a person, in a terminal: approve the ${ok.length} ready entries`,
                  ],
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
    const plan = JSON.parse(readFileSync(file, 'utf8'));
    const ageH = (Date.now() - Date.parse(plan.createdAt)) / 3.6e6;
    if (ageH > PLAN_MAX_AGE_H)
      fail(`the plan is ${ageH.toFixed(0)} h old (max ${PLAN_MAX_AGE_H}): plan again`);
    const ok = plan.entries.filter((e) => e.status === 'ok');
    if (!ok.length) fail('the plan has no ready entries');
    // Pin: what is approved must be byte-for-byte what was planned.
    const drifted = ok.filter((e) => {
      const p = paths(P, byId.get(e.id));
      return sha256(p.latestPng) !== e.latestSha || sha256(p.sig) !== e.baseSha;
    });
    if (drifted.length)
      fail(
        `${drifted.length} renders or baselines changed since planning (${drifted
          .slice(0, 3)
          .map((e) => e.id)
          .join(', ')}…): plan again`
      );
    const status = await fetch(`${serverUrl}/__pxsig/status`, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.json())
      .catch(() => null);
    if (!status)
      fail(
        `the pxsig server is not running (${serverUrl}): start it with \`${CMD} serve\``
      );
    if (status.running || status.queued) fail('a check is running: wait for it, then plan again');
    // The server refuses decisions without its token (lib/guard.mjs); this path read it only after
    // the person-at-a-terminal check above.
    const token = readToken(P.workspaceRoot, serverUrl);
    if (!token)
      fail(`no token from the pxsig server at ${serverUrl} (it writes one when it starts): restart \`${CMD} serve\` with this version`);
    const shape = ok.filter((e) => e.kind === 'shape' && !e.first);
    const first = ok.filter((e) => e.first);
    process.stdout.write(
      `\nApprove ${ok.length} baselines (${ok.length - shape.length - first.length} colour only, ${shape.length} shape changes allowed by name, ${first.length} first baselines).\nReason: ${plan.reason}\n`
    );
    if (first.length) process.stdout.write(`First baselines (nothing to compare them with): ${first.map((e) => e.id).join(', ')}\n`);
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
        headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token },
        body: JSON.stringify({ project: P.name, id: e.id, batch, via: 'cli', reason: plan.reason, kind: e.kind }),
      });
      if (!r.ok) {
        spin.done(
          `stopped at ${e.id}: ${(await r.json().catch(() => ({}))).error ?? r.status}`,
          false
        );
        fail(`approved ${done} of ${ok.length}; undo with \`${CMD} approve undo ${batch}\``, 1);
      }
      spin.update(`approving ${++done}/${ok.length}`);
    }
    spin.done(`approved ${done} entries · batch ${batch}`);
    writeFileSync(
      file,
      `${JSON.stringify({ ...plan, appliedAt: new Date().toISOString(), batch }, null, 2)}\n`
    );
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
                  { key: 'by', label: 'By' },
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
      lock = acquireLock(P, { holder: 'approve undo' });
    } catch (e) {
      fail(`${e.message}. Undo writes baselines, so it needs the store to itself.`, 2);
    }
    const before = new Map(manifest.stories.map((e) => [e.id, sha256(paths(P, e).sig)]));
    let res;
    try {
      res = undoBatch(P, manifest, batch);
    } catch (e) {
      lock.release();
      fail(e.message, 2);
    }
    for (const id of [...res.restored, ...res.removed])
      record(P, byId.get(id), {
        batch: `${batch}-undo`,
        via: 'undo',
        reason: `undo ${batch}${res.source === 'git' ? ' (from git)' : ''}`,
        before: before.get(id) ?? null,
      });
    lock.release();
    if (res.restored.length) await run('check', { ids: res.restored }).catch(() => null);
    emit(
      format,
      [
        { h: 'Restored', sub: `${res.restored.length} baselines from ${batch} (${res.source === 'git' ? 'git history' : 'local snapshot'})${res.removed.length ? ` · ${res.removed.length} first baselines moved to trash/` : ''}` },
        res.refused.length
          ? { h: 'Refused' }
          : { note: res.restored.length ? 'Re-checked against the restored baselines.' : 'Nothing to re-check.' },
        res.refused.length ? { list: res.refused.map((r) => `${r.id} — ${r.why}`) } : {},
      ],
      res
    );
    if (res.refused.length) process.exit(1);
    return;
  }

  if (sub === 'verify') {
    if (flags.adopt) {
      needHuman('approve verify --adopt');
      const r = verify(P, manifest);
      const typed = await ask(
        `Log the ${manifest.stories.length} current baselines as the trusted starting point? Type "ADOPT" to continue: `
      );
      if (typed !== 'ADOPT') fail('not confirmed', 1);
      try {
        acquireLock(P, { holder: 'approve verify --adopt' });
      } catch (e) {
        fail(e.message, 2);
      }
      const batch = newBatch('adopt');
      for (const e of manifest.stories)
        record(P, e, {
          batch,
          via: 'adopt',
          reason: 'adopt current baselines as the starting point',
          before: null,
        });
      emit(
        format,
        [
          {
            h: 'Adopted',
            sub: `${manifest.stories.length} baselines logged (${r.mismatched.length} had drifted from their log)`,
          },
        ],
        { batch }
      );
      return;
    }
    const r = verify(P, manifest);
    const bad = r.mismatched.length;
    emit(
      format,
      [
        { h: 'Baseline integrity', sub: `${r.logged} logged · ${r.untracked} without a log entry` },
        bad
          ? {
              note: `${bad} baselines differ from their last logged approval: written outside the trail`,
              tone: 'bad',
            }
          : {
              note: r.logged
                ? 'Every logged baseline matches its approval.'
                : 'No approvals logged yet.',
              tone: r.logged ? 'ok' : undefined,
            },
        bad
          ? {
              table: {
                cols: [
                  { key: 'id', label: 'Entry' },
                  { key: 'logged', label: 'Logged' },
                  { key: 'now', label: 'Now' },
                ],
                rows: r.mismatched.slice(0, 40),
              },
            }
          : {},
        r.untracked
          ? {
              next: [
                [
                  `${CMD} approve verify --adopt`,
                  'a person, in a terminal: log the current baselines as the starting point',
                ],
              ],
            }
          : {},
      ],
      r
    );
    process.exit(bad ? 1 : 0);
  }

  fail(`usage: approve plan | apply | log | undo <batch> | verify [--adopt]`);
}
