/** What a check's rows would fail on, per gate (enforcement.mjs). */
/** @import { CheckRow } from '../../types.js' */
/** @import { Finding } from '../../types/t2.js' */

/**
 * What a check's rows would fail on, per gate: the visual gate by kind (changed, new, render
 * errors), the a11y gate as the entries with new violations. Rows skipped or approved count for none.
 * @param {readonly CheckRow[]} rows
 * @returns {Finding[]}
 */
export function checkFindings(rows) {
  const checked = rows.filter((r) => !r.skipped);
  const failing = checked.filter((r) => !r.pass && !r.approved);
  const errors = failing.filter((r) => r.error).length;
  const fresh = failing.filter((r) => !r.error && r.new).length;
  const changed = failing.filter((r) => !r.error && !r.new).length;
  /** @type {Finding[]} */
  const found = [];
  if (changed) found.push({ gate: 'visual', exit: 1, count: changed, what: 'changed' });
  if (fresh) found.push({ gate: 'visual', exit: 1, count: fresh, what: 'new' });
  if (errors)
    found.push({
      gate: 'visual',
      exit: 1,
      count: errors,
      what: errors === 1 ? 'render error' : 'render errors',
    });
  if (!found.length) found.push({ gate: 'visual', exit: 0, count: 0, what: 'changed' });
  const a11y = checked.filter((r) => (r.a11y?.new ?? 0) > 0).length;
  found.push({
    gate: 'a11y',
    exit: a11y ? 1 : 0,
    count: a11y,
    what: a11y === 1 ? 'entry with new a11y violations' : 'entries with new a11y violations',
  });
  return found;
}

/**
 * The readiness counts of a check (the readiness tally's fields,
 * docs/configuration.md#enforcement).
 * @param {readonly CheckRow[]} rows
 */
export function checkCounts(rows) {
  /** @param {string} what */
  const by = (what) =>
    checkFindings(rows)
      .filter((f) => f.what.startsWith(what))
      .reduce((n, f) => n + f.count, 0);
  return {
    changed: by('changed'),
    new: by('new'),
    renderErrors: by('render error'),
    a11yNew: by('entr'),
  };
}
