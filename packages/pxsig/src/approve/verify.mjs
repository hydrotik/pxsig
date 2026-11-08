/**
 * approve/verify.mjs — `pxsig approve verify` (approve.mjs hands it its context): baselines whose
 * bytes differ from their last logged approval, baselines with no log line, a rewritten log; and
 * `--adopt`, the current baselines logged as the starting point.
 */
import { existsSync, readFileSync } from 'node:fs';
import { appendedSince, mergeBase, newBatch, record, verify } from '../lib/approvals.mjs';
import { takeLock } from '../lib/lock.mjs';
import { ask, emit } from '../lib/term.mjs';
import {
  appendReadiness,
  lastLine,
  leadLine,
  outcome,
  reportBlock,
  resolveOrExit,
} from '../lib/enforcement.mjs';
/** @import { Manifest } from '../types.js' */
/** @import { VerifyResult } from '../types/t2.js' */
/** @import { ApproveContext } from '../approve.mjs' */

/**
 * `pxsig approve verify [--no-strict] [--since <ref>] [--suite <name> | --all-suites] [--adopt]`.
 * @param {ApproveContext} cx
 */
export async function verifyCommand(cx) {
  const { flags, format, P, CMD, fail, needHuman } = cx;
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

  // Strict by default (docs/migrating.md): a baseline with no log line fails. --no-strict reports it only.
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
      suites: results.map(({ untrackedIds: _untrackedIds, ...r }) => r),
      notCommitted,
      range,
      ...(results.length === 1
        ? (({ untrackedIds: _untrackedIds, suite: _suite, ...r }) => r)(results[0])
        : {}),
      ...(reportBlock(enf, gated) ? { enforcement: reportBlock(enf, gated) } : {}),
    }
  );
  process.exit(gated.exit);
}
