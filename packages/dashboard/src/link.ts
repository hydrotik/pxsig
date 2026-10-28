/**
 * The dashboard link (pxsig serve prints `/report/#ticket=…`; `pxsig serve --link` prints a new one).
 *
 * - On load, a ticket in the fragment is taken out of the address bar and traded once at
 *   `POST /__pxsig/session` for a cookie scripts cannot read; decisions then carry it.
 * - The Storybook panel's inspector is a frame inside another site, where that cookie is not sent.
 *   It decides through a small window of this server's own (`?decide=1`): the window has the
 *   cookie, takes the decision from its opener by message (this origin only), posts it and closes.
 */

/** The server's answer to a decision made without the dashboard link (guard.mjs NEEDS_LINK_CODE). */
export const NEEDS_LINK_CODE = 'needs-dashboard-link';

export class NeedsLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeedsLinkError';
  }
}

/** Trade a ticket in the fragment, if there is one; resolves when the cookie is set (or refused). */
async function takeTicket(): Promise<void> {
  if (typeof location === 'undefined' || !location.protocol.startsWith('http')) return;
  const hash = new URLSearchParams(location.hash.slice(1));
  const ticket = hash.get('ticket');
  if (!ticket) return;
  hash.delete('ticket');
  // Out of the address bar, history and any copy of the URL before anything else runs.
  const rest = hash.toString().replace(/=(&|$)/g, '$1');
  history.replaceState(null, '', `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`);
  await fetch('/__pxsig/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket }),
  }).catch(() => undefined);
}

let ready: Promise<void> = takeTicket();
// The link pasted into a tab already on the dashboard changes only the fragment: no reload.
if (typeof window !== 'undefined')
  window.addEventListener('hashchange', () => (ready = ready.then(takeTicket)));

/** In a frame (the Storybook panel): the dashboard link's cookie is not sent there. */
const framed = () => typeof window !== 'undefined' && window.top !== window.self;

/** The server's answer to a decision: its fields, and on a refusal `error` and `code` (server.md). */
type Answer = Record<string, unknown> & { error?: string; code?: string };

async function post(
  path: string,
  body: string
): Promise<{ ok: boolean; status: number; body: Answer }> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}

type Result = Awaited<ReturnType<typeof post>>;

/** A decision through this server's own small window; resolves with what the server answered. */
function throughWindow(path: string, body: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const w = window.open(
      `${location.pathname}?decide=1`,
      'pxsig-decide',
      'popup,width=460,height=220'
    );
    if (!w)
      return reject(
        new Error(
          'the browser blocked the small window this panel approves through: allow pop-ups for this page, or approve in the dashboard tab'
        )
      );
    const id = Math.random().toString(36).slice(2);
    const done = (fn: () => void) => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      fn();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== w) return;
      if (e.data?.type === 'pxsig-decide-ready')
        w.postMessage({ type: 'pxsig-decide', id, path, body }, location.origin);
      else if (e.data?.type === 'pxsig-decide-result' && e.data.id === id)
        done(() => resolve(e.data.result));
    };
    window.addEventListener('message', onMessage);
    const timer = setTimeout(
      () => done(() => reject(new Error('the approval window did not answer'))),
      120_000
    );
  });
}

/** Post a decision (approve, reject, an a11y decision): the dashboard link's cookie goes with it. */
export async function decide(path: string, body: string): Promise<Record<string, unknown>> {
  await ready;
  const r = framed() ? await throughWindow(path, body) : await post(path, body);
  if (r.ok) return r.body;
  if (r.body.code === NEEDS_LINK_CODE) throw new NeedsLinkError(String(r.body.error ?? ''));
  throw new Error(String(r.body.error ?? r.status));
}

/**
 * The small window's side (`?decide=1`): say ready to the opener (this origin only), take one
 * decision from it, post it here with this window's cookie, answer, and close unless the dashboard
 * link is missing (the window then says what to do). `onState` reports for the window's text.
 */
export function runDecideWindow(
  onState: (
    state: 'waiting' | 'working' | 'needs-link' | 'failed' | 'no-opener',
    detail?: string
  ) => void
): () => void {
  const opener = window.opener as Window | null;
  if (!opener) {
    onState('no-opener');
    return () => {};
  }
  const onMessage = async (e: MessageEvent) => {
    if (e.origin !== location.origin || e.source !== opener || e.data?.type !== 'pxsig-decide')
      return;
    window.removeEventListener('message', onMessage);
    onState('working');
    let result: Result;
    try {
      result = await post(String(e.data.path), String(e.data.body));
    } catch (err) {
      result = { ok: false, status: 0, body: { error: (err as Error).message } };
    }
    opener.postMessage({ type: 'pxsig-decide-result', id: e.data.id, result }, location.origin);
    if (result.ok) window.close();
    else if (result.body.code === NEEDS_LINK_CODE) onState('needs-link');
    else onState('failed', String(result.body.error ?? result.status));
  };
  window.addEventListener('message', onMessage);
  onState('waiting');
  opener.postMessage({ type: 'pxsig-decide-ready' }, location.origin);
  return () => window.removeEventListener('message', onMessage);
}
