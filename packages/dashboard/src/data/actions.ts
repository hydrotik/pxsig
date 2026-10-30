/** Decisions and requests the page sends to the pxsig server (data.ts re-exports each one). */
import { decide } from '../link';
import { type Refusal, withProject } from './request';

// Decisions carry the dashboard link's cookie (link.ts); without it the server refuses them, so an
// agent or a script posting to the server, or reading the page, cannot approve.
export async function reviewAction(
  action: 'approve' | 'reject' | 'unreview',
  id: string
): Promise<void> {
  await decide(`/__pxsig/${action}`, withProject({ id }));
}

/** `unaccept` takes `rule` (or every rule) off the entry's accepted list. */
export async function a11yAction(
  action: 'accept' | 'reject' | 'unreview' | 'unaccept',
  id: string,
  rule?: string
): Promise<void> {
  await decide(`/__pxsig/a11y-${action}`, withProject(rule ? { id, rule } : { id }));
}

/** `POST /__pxsig/check`'s answer, or a refusal (server.md). */
type RecheckAnswer = Refusal & {
  queued?: string[];
  registered?: string[];
  skipped?: { name: string; why: string }[];
};

/** Queue entries (or stories) for a re-check on the server. Never writes a baseline. */
export async function recheck(
  ids: string[]
): Promise<{ queued: string[]; registered?: string[]; skipped?: { name: string; why: string }[] }> {
  const r = await fetch('/__pxsig/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: withProject({ ids }),
  });
  // The server's answer (server.md); a body that is not JSON reads as {}.
  const body = await (r.json() as Promise<RecheckAnswer>).catch((): RecheckAnswer => ({}));
  if (!r.ok) throw new Error(body.error || r.statusText);
  return { queued: body.queued ?? [], registered: body.registered, skipped: body.skipped };
}

/**
 * Approve every entry of a story that waits for a decision, in one batch (a person's click; the
 * server leaves out entries that pass, did not render, or were rejected, and says why).
 */
export async function approveStory(
  story: string
): Promise<{ approved: string[]; skipped: { id: string; why: string }[]; batch: string }> {
  return (await decide('/__pxsig/approve-story', withProject({ story }))) as {
    approved: string[];
    skipped: { id: string; why: string }[];
    batch: string;
  };
}

/** `POST /__pxsig/repair`'s answer (server.md). */
type RepairAnswer = {
  applied?: { action: string; result: string }[];
  plan: { steps: { action: string; ids: string[] }[] };
};

/** Run the safe repairs on the server (never writes signatures, never approves, never prunes). */
export async function repairSafe(): Promise<RepairAnswer> {
  const r = await fetch('/__pxsig/repair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: withProject({ apply: true }),
  });
  // The repair's answer, or a refusal; a body that is not JSON reads as {} (as before, returned
  // as it is when the answer was ok).
  const body = await (r.json() as Promise<RepairAnswer & Refusal>).catch(
    () => ({}) as RepairAnswer & Refusal
  );
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
}
