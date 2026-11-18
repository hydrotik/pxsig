/**
 * Rule 1's second half (ui-tools.mjs `checkAll`): a dashboard file outside src/ui/ reaches the UI
 * layer through `@ui` only, never by a relative path into src/ui/ (an adapter, the fallbacks, the
 * runtime, the contract's files). src/ui/tokens.ts is the exception: the stylesheets read the
 * neutral tokens at build time, without the adapter `@ui` brings with it.
 */
import path from 'node:path';

/** The one file under src/ui/ a relative import from outside it may name (without its extension). */
const OPEN = 'ui/tokens';

/**
 * What is wrong with `spec`, imported by `file` (a path relative to src/, `/`-separated), or null.
 * @param {string} file
 * @param {string} spec
 */
export function uiReachProblem(file, spec) {
  if (!spec.startsWith('.') || file === 'ui' || file.startsWith('ui/')) return null;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  if (target !== 'ui' && !target.startsWith('ui/')) return null;
  if (target.replace(/\.(tsx?|mjs|js)$/, '') === OPEN) return null;
  return `src/${file}: imports "${spec}", inside src/ui/; outside src/ui/ the UI comes from @ui (only ../ui/tokens may be imported by path)`;
}
