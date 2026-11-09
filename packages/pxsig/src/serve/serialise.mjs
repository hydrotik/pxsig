/**
 * serve/serialise.mjs — one project's decision writes, one after another. A decision reads the
 * project's review.json (or a11y-review.json, a11y.json), awaits work such as a capture, then
 * writes the file back: two overlapping decisions (two tabs, or MCP and the dashboard) would each
 * write what it read, and the later write would drop the earlier decision. Each key has a promise
 * chain; a call runs once the one before it settled, whether it succeeded or failed.
 */

/** @type {Map<string, Promise<void>>} */
const chains = new Map();

/**
 * Run `fn` after every earlier call with the same `key` has settled; its result or error is the
 * answer, and a failure never holds up the next call.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function serialise(key, fn) {
  const run = (chains.get(key) ?? Promise.resolve()).then(fn);
  const tail = run.then(
    () => {},
    () => {}
  );
  chains.set(key, tail);
  // The last call of a key removes its chain, so the map holds only keys with work in flight.
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}
