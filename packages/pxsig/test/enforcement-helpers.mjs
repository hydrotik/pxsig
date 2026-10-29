// What enforcement.test.mjs and enforcement-cli.test.mjs share: the src path, a stand-in project,
// a person and a CI caller, and a date helper.
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const src = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * A stand-in project: just what resolveEnforcement reads.
 * @param {Record<string, unknown> | undefined} enforcement
 * @param {Record<string, string>} [sources]
 */
export const proj = (enforcement, sources = {}) => ({
  name: 'p',
  workspaceRoot: tmpdir(),
  config: enforcement === undefined ? {} : { enforcement },
  configSources: sources,
});
export const person = { human: () => true };
export const robot = { human: () => false, why: () => 'refused in CI (CI is set)' };
/** @param {string} iso */
export const at = (iso) => new Date(iso);
