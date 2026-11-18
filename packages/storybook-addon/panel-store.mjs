/**
 * The panel's state and its traffic to the server, kept small: plain functions, no Storybook
 * import, so the tests run them under Node.
 * - `createStore`: the state the panel reads with `useSyncExternalStore`; an update that changes
 *   nothing notifies no one, so the panel does not re-render.
 * - `coalesce`: one refresh for a burst of server events (hello, data, review and integrity
 *   arrive together), and never two at once.
 * - `sameList`: whether the sidebar statuses would change, so an unchanged answer leaves the
 *   status store alone.
 * - `postCheck`: starts a check and says, in a line of text, why one did not start.
 */

/**
 * Whether two values have the same JSON (the server's answers are JSON: no functions, no cycles).
 * @param {unknown} a
 * @param {unknown} b
 */
const sameJson = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * @template {object} S
 * @param {S} initial
 */
export function createStore(initial) {
  let state = initial;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  return {
    /** The current state; the same object until an update changes it. */
    get: () => state,
    /** @param {() => void} fn */
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    /**
     * Merges `patch` into the state. Returns false, and notifies no one, when nothing changed.
     * @param {Partial<S>} patch
     */
    update: (patch) => {
      const keys = /** @type {(keyof S)[]} */ (Object.keys(patch));
      if (keys.every((k) => sameJson(state[k], patch[k]))) return false;
      state = { ...state, ...patch };
      for (const fn of listeners) fn();
      return true;
    },
  };
}

/**
 * `run` at most once per `delay` ms for any number of calls, and never while a run is still going:
 * a call during a run schedules one more run after it.
 * @param {() => Promise<void>} run must not reject
 * @param {number} [delay]
 */
export function coalesce(run, delay = 50) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let running = false;
  let again = false;
  const fire = async () => {
    timer = null;
    running = true;
    try {
      await run();
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    if (running) again = true;
    else timer ??= setTimeout(fire, delay);
  };
  return schedule;
}

/**
 * Whether a status list is the one last given to the status store (`null`: none given yet).
 * @param {unknown[]} list
 * @param {string | null} last the previous list's key
 * @returns {{ same: boolean, key: string }}
 */
export function sameList(list, last) {
  const key = JSON.stringify(list);
  return { same: key === last, key };
}

/**
 * POSTs a check request. Resolves to null when the server took it, else to a line saying why not.
 * @param {string} server
 * @param {{ story?: string, all?: boolean }} body
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string | null>}
 */
export async function postCheck(server, body, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${server}/__pxsig/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.ok ? null : `Check not started: the pxsig server answered ${r.status}.`;
  } catch {
    return 'Check not started: no answer from the pxsig server.';
  }
}
