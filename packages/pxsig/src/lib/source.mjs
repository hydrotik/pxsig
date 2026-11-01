/**
 * source.mjs — where a project's entries come from, as its committed manifest says (docs/spec.md
 * section 6): Storybook stories (the default), or the pxsig dashboard's own screens
 * (`dashboard-screens`, written by the pxsig repository's scripts/screens-check.mjs). A project of
 * screens has no Storybook: nothing fetches one for it, and `pxsig check` refuses it.
 */
import { readFileSync } from 'node:fs';

export const SCREENS = 'dashboard-screens';

/**
 * @param {string} manifestPath
 * @returns {'storybook' | 'dashboard-screens'}
 */
export function manifestSource(manifestPath) {
  try {
    // The manifest pxsig or screens-check.mjs wrote; a missing or unreadable one is a story project.
    const m = /** @type {{ source?: unknown }} */ (JSON.parse(readFileSync(manifestPath, 'utf8')));
    return m.source === SCREENS ? SCREENS : 'storybook';
  } catch {
    return 'storybook';
  }
}
