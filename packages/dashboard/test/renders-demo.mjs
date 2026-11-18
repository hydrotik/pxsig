/**
 * renders-demo.mjs — the demo project the render tests drive (renders.test.mjs,
 * renders-large.test.mjs): components × 4 stories × 2 modes, every sixth entry changed.
 */
import { changed, data, history, inComponent, row, spread } from '../fixtures/scenarios.mjs';

const NAMED = ['Button', 'Card', 'Dialog', 'Input', 'Menu', 'Table'];
const STORIES = ['default', 'primary', 'disabled', 'long-label'];

/**
 * @param {number} [entries] about this many entries (a multiple of 8); 48 by default, the six
 *   named components
 */
export function demo(entries = 48) {
  const count = Math.max(1, Math.round(entries / (STORIES.length * 2)));
  const components = Array.from({ length: count }, (_, i) => NAMED[i] ?? `Part${i}`);
  const ids = components.flatMap((c) =>
    STORIES.flatMap((st) => [`ui-${c.toLowerCase()}--${st}`, `ui-${c.toLowerCase()}--${st}@light`])
  );
  const isChanged = (/** @type {number} */ i) => i % 6 === 1;
  const d = spread(
    data({
      rows: ids.map((id, i) =>
        row(
          id,
          isChanged(i) ? { ...changed, ...(id.includes('@light') ? { mode: 'light' } : {}) } : {}
        )
      ),
      entries: ids.map((id, i) =>
        inComponent(
          components[Math.floor(i / (STORIES.length * 2))],
          id,
          isChanged(i) ? [{ code: 'changed', severity: 'warn', reason: 'gate failed' }] : []
        )
      ),
    })
  );
  d.history = history(6);
  return d;
}
