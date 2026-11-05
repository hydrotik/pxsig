/**
 * check/select.mjs — stage 1: the entries this run checks (`--modes`, `--only`, `--since` /
 * `--changed` through `pxsig affected`), and the `--only` names the manifest does not have yet.
 */
/** @import { CheckSetup, Die } from './setup.mjs' */
/** @import { AffectedResult } from '../types/t4.js' */

/** @typedef {ReturnType<typeof select>} Selection */

/** @param {CheckSetup} S */
export function select(S) {
  const { manifest, str, rust, runPath, P, suite } = S;
  /** @type {Die} */
  const die = S.die;
  // --- 1. select -----------------------------------------------------------------------
  let entries = manifest.stories;
  const modes = str('modes')?.split(',');
  if (modes) entries = entries.filter((e) => modes.includes(e.mode ?? manifest.defaultMode));
  const only = str('only')?.split(',');
  if (only) entries = entries.filter((e) => only.includes(e.id) || only.includes(e.story));
  /** @type {AffectedResult | null} */
  let affected = null;
  /** @type {Set<string> | null} */
  let affectedIds = null;
  if (str('since') || str('changed')) {
    // Whichever flag the condition just found set.
    const how = /** @type {string[]} */ (
      str('changed') ? ['--files', str('changed')] : ['--since', str('since')]
    );
    const r = rust([
      'affected',
      '--manifest',
      runPath,
      '--root',
      P.workspaceRoot,
      ...how,
      '--json',
    ]);
    // `pxsig affected --json` (docs/cli.md).
    affected = /** @type {AffectedResult} */ (JSON.parse(r.out));
    const ids = new Set(affected.ids);
    affectedIds = ids;
    console.log(
      `[check] affected ${str('changed') ? 'by --changed' : `since ${str('since')}`}: ${affected.changed.length} changed files → ${ids.size} entries (${affected.reason}) in ${r.ms.toFixed(0)} ms`
    );
    // The fail-safe: a path the selection cannot trace selects everything, and says which (docs/ci.md).
    for (const f of (affected.failSafe ?? []).slice(0, 10))
      console.log(`[check]   all: ${f.why} (${f.class})`);
    if ((affected.failSafe?.length ?? 0) > 10)
      console.log(`[check]   … ${affected.failSafe.length - 10} more in check.json`);
    for (const [s, n] of Object.entries(affected.otherSuites ?? {}))
      console.log(`[check]   ${n} changed entries are in suite ${s}: check them with --suite ${s}`);
    const costly = (affected.unresolved ?? []).filter(
      (u) => !u.accepted && u.selects === 'entries'
    );
    if (costly.length)
      console.log(
        `[check]   +${new Set(costly.map((u) => u.file)).size} files with unresolved imports add their entries to every run (pxsig affected lists them)`
      );
    entries = entries.filter((e) => ids.has(e.id));
  }
  const selected = new Set(entries.map((e) => e.id));
  // --only names the manifest does not have (a story just written): registered below, once the
  // store lock is held and Storybook answers, so checking a new story is one command.
  const unregistered =
    only && !suite
      ? only.filter((n) => !manifest.stories.some((e) => e.id === n || e.story === n))
      : [];
  if (!entries.length && !affected && !unregistered.length) die('no entries selected');
  return { entries, modes, only, affected, affectedIds, selected, unregistered };
}
