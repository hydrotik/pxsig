/**
 * retry.mjs — one retry for a transient local socket failure. On a loaded machine (a Windows CI
 * runner, a busy VDI) a single connection to a local server can be reset, refused while its accept
 * queue is full, or run out of socket buffers (WSAENOBUFS), although the server is up. Each of
 * pxsig's own probes and page loads gets one retry for those, never for an answer the server gave
 * (an HTTP error, Storybook's error screen) and never more than one.
 *
 * Used by: serverStatus (repair/apply.mjs), fetchStoryIndex (integrity/stories.mjs), the story
 * render's navigation (capture/render.mjs) and the dashboard check's page load
 * (dashboard-check/capture.mjs).
 */

/** The pause before the retry. */
export const RETRY_MS = 250;

/**
 * Socket errors from Node's fetch (the `cause.code` of its TypeError) that say the connection
 * broke, not that nothing listens: reset by the peer, closed by it before an answer (undici's
 * UND_ERR_SOCKET), a write to a closed socket, aborted by the OS, out of buffers (Windows).
 */
export const SOCKET_CODES = new Set([
  'ECONNRESET',
  'UND_ERR_SOCKET',
  'EPIPE',
  'ECONNABORTED',
  'ENOBUFS',
]);

/**
 * Chromium's network errors (`page.goto: net::ERR_…`) for a navigation whose connection failed:
 * the same family as SOCKET_CODES, plus a refused connection (a full accept queue on Windows
 * refuses). A timeout is not here: a navigation already waits 30 s.
 */
export const NAV_CODES = [
  'ERR_NO_BUFFER_SPACE',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_ABORTED',
  'ERR_CONNECTION_REFUSED',
  'ERR_EMPTY_RESPONSE',
  'ERR_SOCKET_NOT_CONNECTED',
];

/**
 * The socket error code of a rejected fetch (its `cause.code`), else its own string `code` or `name`
 * (`TimeoutError` for AbortSignal.timeout).
 * @param {unknown} e
 * @returns {string}
 */
export function errorCode(e) {
  const err = /** @type {{ cause?: { code?: unknown }, code?: unknown, name?: unknown }} */ (
    e ?? {}
  );
  // A DOMException's own `code` is a legacy number (23 for a timeout): its `name` says what it is.
  const code = err.cause?.code ?? (typeof err.code === 'string' ? err.code : err.name);
  return typeof code === 'string' ? code : '';
}

/**
 * Is this rejected fetch a broken connection? `refused`: a refused connection counts too;
 * `timeout`: so does running out of time.
 * @param {unknown} e
 * @param {{ refused?: boolean, timeout?: boolean }} [opts]
 */
export function isSocketError(e, { refused = false, timeout = false } = {}) {
  const code = errorCode(e);
  return (
    SOCKET_CODES.has(code) ||
    (refused && code === 'ECONNREFUSED') ||
    (timeout && code === 'TimeoutError')
  );
}

/**
 * The NAV_CODES error a navigation failed with, or null (any other failure).
 * @param {unknown} e
 * @returns {string | null}
 */
export function navErrorCode(e) {
  const m = String(/** @type {{ message?: unknown }} */ (e)?.message ?? e).match(
    /net::(ERR_[A-Z_]+)/
  );
  return m && NAV_CODES.includes(m[1]) ? m[1] : null;
}

/**
 * Run `attempt`; when it throws an error `when` accepts, wait `delayMs`, run `before` (e.g. open a
 * fresh page) and run `attempt` once more. Any other error, or the second one, is thrown.
 * @template T
 * @param {(n: 0 | 1) => Promise<T>} attempt
 * @param {{ when: (e: unknown) => boolean, delayMs?: number, before?: () => unknown }} opts
 * @returns {Promise<{ value: T, retried: unknown }>} `retried`: the first error, or null
 */
export async function retryOnce(attempt, { when, delayMs = RETRY_MS, before }) {
  try {
    return { value: await attempt(0), retried: null };
  } catch (e) {
    if (!when(e)) throw e;
    await new Promise((r) => setTimeout(r, delayMs));
    await before?.();
    return { value: await attempt(1), retried: e };
  }
}
