/**
 * What the coverage block counts and when it shows: integrity and setup findings by severity, and
 * the server's repair plan. Changed, new and accessibility entries are review work, counted by the
 * review queues, never here; info findings never show the block. Type imports only, so the tests
 * import this file as it is.
 */
import type { Data, IntegrityLedger } from '../data/types';

/** Entry codes that are review work (the changed, new and accessibility queues). */
export const REVIEW_CODES: ReadonlySet<string> = new Set(['changed', 'unbaselined', 'a11y-new']);

type Counted = 'error' | 'warn';
export interface Findings {
  /** Entries, each at the worst severity of its findings that are not review work. */
  entries: Record<Counted, number>;
  /** Setup findings. */
  setup: Record<Counted, number>;
  /** Both together. */
  error: number;
  warn: number;
}

const counted = (s: string): s is Counted => s === 'error' || s === 'warn';

export function coverageFindings(L: IntegrityLedger): Findings {
  const entries = { error: 0, warn: 0 };
  for (const x of L.entries) {
    const found = x.issues.filter((i) => !REVIEW_CODES.has(i.code)).map((i) => i.severity);
    if (found.includes('error')) entries.error++;
    else if (found.includes('warn')) entries.warn++;
  }
  const setup = { error: 0, warn: 0 };
  for (const x of L.setup) if (counted(x.severity)) setup[x.severity]++;
  return { entries, setup, error: entries.error + setup.error, warn: entries.warn + setup.warn };
}

/**
 * The headline's counts: the findings the block lists, by severity (setup findings, and entry errors
 * by code). Entry warnings are not listed: `entryWarnings` is their own line beside "View
 * components". Info findings are never counted.
 */
export function headlineCounts(L: IntegrityLedger): Record<Counted | 'entryWarnings', number> {
  const f = coverageFindings(L);
  return { error: f.error, warn: f.setup.warn, entryWarnings: f.entries.warn };
}

/** Each error code that is not review work, with how many entries have it: the headline's detail. */
export function errorCodes(L: IntegrityLedger): [code: string, entries: number][] {
  const n = new Map<string, number>();
  for (const x of L.entries)
    for (const code of new Set(
      x.issues.filter((i) => i.severity === 'error' && !REVIEW_CODES.has(i.code)).map((i) => i.code)
    ))
      n.set(code, (n.get(code) ?? 0) + 1);
  return [...n];
}

/** The entries the safe repair would act on; 0 when its plan has no step (no button then). */
export const repairEntries = (d: Pick<Data, 'repair'>): number =>
  d.repair?.steps.length ? d.repair.entries : 0;

/**
 * Whether the block shows for its findings: an error, a setup warning, or a repair to run. Entry
 * warnings alone are left to Coverage, and info findings never show it.
 */
export function coverageShown(d: Pick<Data, 'integrity' | 'repair'>): boolean {
  const L = d.integrity;
  if (!L) return false;
  const f = coverageFindings(L);
  return f.error > 0 || f.setup.warn > 0 || repairEntries(d) > 0;
}

/** Whether "View components" has somewhere to go: entries with findings, or waiting for approval. */
export function concernsComponents(L: IntegrityLedger): boolean {
  const f = coverageFindings(L);
  return f.entries.error + f.entries.warn > 0 || (L.summary.byCode.unbaselined ?? 0) > 0;
}
