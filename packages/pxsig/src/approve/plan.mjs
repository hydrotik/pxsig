/**
 * approve/plan.mjs — `pxsig approve plan` and `pxsig approve apply` (approve.mjs hands each its
 * context): classify the changed entries and pin their hashes, then approve the plan through the
 * server, a person at a terminal confirming.
 */
import { existsSync, readFileSync } from 'node:fs';
import { newBatch, paths, sha256, who } from '../lib/approvals.mjs';
import { notKept, reportsIgnored } from '../lib/decisions.mjs';
import { readToken, TOKEN_HEADER } from '../lib/guard.mjs';
import { readImage } from '../lib/psig.mjs';
import { classify } from '../lib/shape.mjs';
import { ask, emit, progress } from '../lib/term.mjs';
import { writeJson } from '../lib/files.mjs';
import { serverStatus } from '../lib/repair/apply.mjs';
/** @import { ManifestEntry } from '../types.js' */
/** @import { ApproveContext } from '../approve.mjs' */

const PLAN_MAX_AGE_H = 24;
/** The plan's Reason when the store's reports/ (where the plan and the reason live) is not ignored. */
const NOT_KEPT = 'not kept (reports/ is not git-ignored)';

/**
 * One entry of an approval plan (`approval-plan.json`).
 * @typedef {{ id: string, status: string, why: string, state?: string, latestSha?: string | null, baseSha?: string | null, kind?: string, shape?: string, shapePct?: number | null, first?: true }} PlanEntry
 */

/**
 * `pxsig approve plan`: classify each changed (or NEW) entry, pin its hashes, write the plan.
 * @param {ApproveContext} cx
 */
export async function planCommand(cx) {
  const { args, flags, format, P, CMD, fail, run, manifest, byId, planPath, rel } = cx;
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
      .filter((e) => e.state === 'changed' && e.id.includes(String(flags.component).toLowerCase()))
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
    else if (!base.latestSha) entries.push({ ...base, status: 'blocked', why: 'no latest render' });
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
    // The plan sits in reports/: it holds the reason only where git leaves reports/ out.
    reason: reportsIgnored(P) ? reason : null,
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
          ['Reason', plan.reason ?? NOT_KEPT],
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

/**
 * `pxsig approve apply`: re-hash the plan, ask for the phrase, approve each entry through the server.
 * @param {ApproveContext} cx
 */
export async function applyCommand(cx) {
  const { args, format, P, serverUrl, CMD, fail, byId, planPath, rel, needHuman } = cx;
  needHuman('approve apply');
  const file = args[0] ?? planPath;
  if (!existsSync(file)) fail(`no plan at ${rel(file)}: run \`${CMD} approve plan\` first`);
  // A plan `approve plan` wrote (the hashes below refuse one that does not match the store).
  const plan = /** @type {{ createdAt: string, reason: string | null, entries: PlanEntry[] }} */ (
    JSON.parse(readFileSync(file, 'utf8'))
  );
  const ageH = (Date.now() - Date.parse(plan.createdAt)) / 3.6e6;
  if (ageH > PLAN_MAX_AGE_H)
    fail(`the plan is ${ageH.toFixed(0)} h old (max ${PLAN_MAX_AGE_H}): plan again`);
  const ok = plan.entries.filter((e) => e.status === 'ok');
  if (!ok.length) fail('the plan has no ready entries');
  // An entry the manifest no longer has (its story was removed or renamed since planning).
  const missing = ok.filter((e) => !byId.has(e.id));
  if (missing.length)
    fail(
      `${missing.length} planned entries are no longer in the manifest: ${missing
        .slice(0, 3)
        .map((e) => e.id)
        .join(', ')}${missing.length > 3 ? '…' : ''}: plan again`
    );
  // Pin: what is approved must be byte-for-byte what was planned.
  const drifted = ok.filter((e) => {
    // Every id is in the manifest: checked just above.
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
  // This workspace's server: one that serves another workspace counts as not running.
  const status = await serverStatus(serverUrl, P.workspaceRoot);
  if (!status.up)
    fail(
      status.foreign ??
        `the pxsig server is not running (${serverUrl}): start it with \`${CMD} serve\``
    );
  if (status.up && (status.running || status.queued))
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
    `\nApprove ${ok.length} baselines (${ok.length - shape.length - first.length} colour only, ${shape.length} shape changes allowed by name, ${first.length} first baselines).\nReason: ${plan.reason ?? NOT_KEPT}\n`
  );
  // The server keeps it beside each line's ref when reports/ is git-ignored (lib/decisions.mjs).
  if (!plan.reason || !reportsIgnored(P)) process.stderr.write(`${notKept(P)}\n`);
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
