/**
 * dashboard-check/requests.mjs — the requests a screen's page made that failed (capture.mjs).
 *
 * The page's state comes from requests it makes once, after it loads: the data, whether it can
 * approve (`/__pxsig/status`) and the live connection (`/__pxsig/events`). A request that never
 * reaches the server (Windows' ERR_NO_BUFFER_SPACE while several screens load at once) leaves the
 * page without that state for good: no wait brings it back. Such a screen is taken again once, as
 * a failed page load is (capture.mjs `load`), and a screen that still fails names the requests.
 */
/** @import { Page } from 'playwright' */

/** @typedef {{ path: string, why: string }} FailedRequest */

/**
 * Note every request of `page` that failed, in `failed`: its path (never the host) and Chromium's
 * error. The page load is not one (`load` retries it), nor a request the page dropped itself (a
 * navigation away, a closed EventSource).
 * @param {Pick<Page, 'on'>} page
 * @param {FailedRequest[]} failed
 */
export function watchRequests(page, failed) {
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? 'failed';
    if (r.isNavigationRequest() || why === 'net::ERR_ABORTED') return;
    const u = new URL(r.url());
    failed.push({ path: u.pathname, why });
  });
}

/**
 * Did a request fail with `code` (e.g. ERR_NO_BUFFER_SPACE)?
 * @param {FailedRequest[]} failed
 * @param {string} code
 */
export const failedWith = (failed, code) => failed.some((f) => f.why === `net::${code}`);

/**
 * The failed requests, said after a screen's reason: ` (request failed: /__pxsig/status
 * net::ERR_…)`, the first three; empty when none failed.
 * @param {FailedRequest[]} failed
 */
export const saidFailed = (failed) =>
  failed.length
    ? ` (request failed: ${failed
        .slice(0, 3)
        .map((f) => `${f.path} ${f.why}`)
        .join(', ')}${failed.length > 3 ? `, ${failed.length - 3} more` : ''})`
    : '';
