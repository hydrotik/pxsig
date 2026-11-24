/** "Repair baseline records" (server.md): the plan, and the repair a person confirms. */
import { decide } from '../link';
import { type Refusal, scope, withProject } from './request';

/** One mismatched entry of the plan: `file` is its baseline's sha256 when listed. */
export interface RecordRepairItem {
  id: string;
  file: string | null;
  record: string;
  image: string;
  why?: string;
  reasons?: string[];
}

/** `GET /__pxsig/record-repair-plan`'s plan. */
export interface RecordRepairPlan {
  createdAt: string;
  checked: number;
  mismatched: number;
  eligible: RecordRepairItem[];
  ineligible: RecordRepairItem[];
}

/** The repair's answer. */
export interface RecordRepairAnswer {
  batch: string | null;
  repaired: string[];
  notWritten: { id: string; why: string }[];
}

/** The plan, read now (reads only). */
export async function recordRepairPlan(): Promise<RecordRepairPlan> {
  const r = await fetch(`/__pxsig/record-repair-plan${scope()}`);
  // The plan, or a refusal; a body that is not JSON reads as {}.
  const body = await (r.json() as Promise<{ plan?: RecordRepairPlan } & Refusal>).catch(
    (): { plan?: RecordRepairPlan } & Refusal => ({})
  );
  if (!r.ok || !body.plan) throw new Error(body.error || r.statusText);
  return body.plan;
}

/**
 * Repair the listed eligible entries: a decision, with the dashboard link's cookie. The server
 * writes only those still eligible with the bytes they had when listed.
 */
export async function repairRecords(items: RecordRepairItem[]): Promise<RecordRepairAnswer> {
  return (await decide(
    '/__pxsig/record-repair',
    withProject({ items: items.map((x) => ({ id: x.id, file: x.file })) })
  )) as unknown as RecordRepairAnswer;
}
