/**
 * approve/repair-records.mjs — `pxsig approve repair-records [--yes]` (approve.mjs hands it its
 * context): list the baselines whose record and image come from different renders, which of them
 * may have their record written again from their own image and why, and which may not and why
 * (lib/approvals/record-repair.mjs). Without `--yes` it lists, writes the list as the plan, and
 * changes no baseline: anyone may run it. `--yes` is a person's at a terminal: it takes the store
 * lock, lists again, and writes only the listed entries that are still eligible with the bytes they
 * had when listed. It approves no change; the others go through review one entry at a time.
 */
import {
  applyRecordRepair,
  listedPlan,
  planFile,
  planRecordRepair,
  PLAN_MAX_AGE_H,
  stillEligible,
} from '../lib/approvals/record-repair.mjs';
import { writeJson } from '../lib/files.mjs';
import { takeLock } from '../lib/lock.mjs';
import { emit } from '../lib/term.mjs';
/** @import { ApproveContext } from '../approve.mjs' */
/** @import { RepairPlan } from '../lib/approvals/record-repair.mjs' */
/** @import { Block } from '../types/t2.js' */

/** The four conditions an eligible entry meets, as its table row says them. */
const QUALIFIES = 'pair differs · render is the image · passes without colour · migrate only';

/**
 * @param {RepairPlan} plan
 * @returns {Block[]}
 */
export const planBlocks = (plan) => [
  {
    h: 'Repair baseline records',
    sub: `${plan.checked} baselines checked · ${plan.mismatched} hold a record and an image from different renders · ${plan.eligible.length} eligible`,
  },
  plan.eligible.length
    ? {
        table: {
          cols: [
            { key: 'id', label: 'Eligible' },
            { key: 'record', label: 'Record' },
            { key: 'image', label: 'Image' },
            { key: 'why', label: 'Qualifies' },
          ],
          rows: plan.eligible.map((x) => ({
            id: x.id,
            record: x.record.slice(0, 12),
            image: x.image.slice(0, 12),
            why: QUALIFIES,
          })),
        },
      }
    : {},
  plan.ineligible.length
    ? {
        table: {
          cols: [
            { key: 'id', label: 'Not eligible' },
            { key: 'why', label: 'Reason' },
          ],
          rows: plan.ineligible.map((x) => ({ id: x.id, why: (x.reasons ?? []).join('; ') })),
        },
      }
    : {},
  plan.mismatched
    ? {
        note: 'Eligible: the record and image differ, the latest render is the baseline image pixel for pixel, it passes the current record under every rule except the colour rule, and only pxsig migrate approved the baseline. A repair writes the record from the image already in the baseline and approves no change: the image, masks, thresholds and config stay as they are. Review each entry that is not eligible in the dashboard.',
      }
    : { note: 'Every baseline record matches its image.', tone: 'ok' },
];

/**
 * `pxsig approve repair-records [--yes]`.
 * @param {ApproveContext} cx
 */
export async function repairRecordsCommand(cx) {
  const { flags, format, P, CMD, fail, manifest, needHuman, rel } = cx;
  if (flags.yes && flags['dry-run']) fail('--dry-run lists, --yes writes: give one', 2);
  /** The plan now; the engine's refusal (not built, too old) or its check failing exits 2. */
  const planNow = () => {
    try {
      return planRecordRepair(P, manifest);
    } catch (e) {
      return fail(/** @type {Error} */ (e).message, 2);
    }
  };
  if (!flags.yes) {
    const plan = planNow();
    writeJson(planFile(P), plan, { pretty: true });
    emit(
      format,
      [
        ...planBlocks(plan),
        plan.eligible.length
          ? {
              next: [
                [
                  `${CMD} approve repair-records --yes`,
                  `a person, in a terminal: write these ${plan.eligible.length} records again from their images (the list is kept ${PLAN_MAX_AGE_H} h)`,
                ],
              ],
            }
          : {},
      ],
      { ...plan, dryRun: true, plan: rel(planFile(P)) }
    );
    return;
  }
  needHuman('approve repair-records --yes');
  const listed =
    listedPlan(P) ??
    fail(
      `no list to apply from the last ${PLAN_MAX_AGE_H} h: run \`${CMD} approve repair-records\` first and read it`,
      1
    );
  if (!listed.eligible.length) fail('the list has no eligible entry: nothing to write', 1);
  /** @type {import('../types.js').LockHandle} */
  const lock = await takeLock(P, { holder: 'approve repair-records' }).catch((e) =>
    // takeLock throws Errors: a LockError (with `exit` when it needs a person), or the fs error.
    fail(/** @type {Error} */ (e).message, /** @type {{ exit?: number }} */ (e).exit ?? 2)
  );
  const run = () => {
    try {
      const picked = stillEligible(planNow(), listed.eligible);
      const res = applyRecordRepair(P, manifest, picked.go, {
        via: 'cli',
        check: () => lock.check(),
      });
      writeJson(
        planFile(P),
        { ...listed, appliedAt: new Date().toISOString(), batch: res.batch },
        { pretty: true }
      );
      return { res, dropped: picked.dropped };
    } catch (e) {
      lock.release();
      return fail(/** @type {Error} */ (e).message, 2);
    }
  };
  const { res, dropped } = run();
  lock.release();
  emit(
    format,
    [
      {
        h: 'Repaired baseline records',
        sub: `${res.repaired.length} of ${listed.eligible.length} listed`,
      },
      res.batch
        ? {
            kv: [
              ['Batch', res.batch],
              ['Log', rel(P.store.approvals)],
            ],
          }
        : {},
      res.repaired.length
        ? {
            table: {
              cols: [
                { key: 'id', label: 'Repaired' },
                { key: 'from', label: 'Record before' },
                { key: 'to', label: 'Record after' },
              ],
              rows: res.repaired.map((l) => ({
                id: l.id,
                from: String(l.recordBefore).slice(0, 12),
                to: String(l.recordAfter).slice(0, 12),
              })),
            },
          }
        : {},
      dropped.length || res.failed.length
        ? {
            table: {
              cols: [
                { key: 'id', label: 'Not written' },
                { key: 'why', label: 'Reason' },
              ],
              rows: [...dropped, ...res.failed.map((x) => ({ id: x.id, why: x.error }))],
            },
          }
        : {},
      res.batch
        ? {
            next: [
              [`${CMD} approve verify`, 'every repaired record matches its image'],
              [`${CMD} approve undo ${res.batch}`, 'put the previous records back'],
            ],
          }
        : {},
    ],
    {
      batch: res.batch,
      repaired: res.repaired.map((l) => ({
        id: l.id,
        recordBefore: l.recordBefore,
        recordAfter: l.recordAfter,
      })),
      notWritten: [...dropped, ...res.failed.map((x) => ({ id: x.id, why: x.error }))],
    }
  );
  process.exit(dropped.length || res.failed.length ? 1 : 0);
}
