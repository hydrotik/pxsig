/**
 * integrity-helpers.mjs — what the integrity and repair tests share: the test folder, the ledger
 * typedefs, and the codes and status of one entry in a ledger.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));

/**
 * The ledger as lib/integrity.mjs builds it.
 * @typedef {Awaited<ReturnType<typeof import('../src/lib/integrity.mjs').reconcile>>} Ledger
 * @typedef {Ledger['entries'][number]} LedgerEntry
 * @typedef {LedgerEntry['issues'][number]} LedgerIssue
 * @typedef {Ledger['components'][number]} LedgerComponent
 */
// Casts below: an id, code or component the fixture holds, so the lookup finds it (a miss fails
// the test at the next read, as it did untyped).

/**
 * @param {Ledger} ledger
 * @param {string} id
 */
export const codesOf = (ledger, id) =>
  ledger.entries.find((x) => x.id === id)?.issues.map((i) => i.code) ?? null;
/**
 * @param {Ledger} ledger
 * @param {string} id
 */
export const statusOf = (ledger, id) => ledger.entries.find((x) => x.id === id)?.status ?? null;
