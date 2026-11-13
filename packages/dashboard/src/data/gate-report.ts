/**
 * The inspector's Report to pxsig (inspector/GateReport.tsx) through the server (server.md): the
 * self-check, the entry re-rendered and checked on this machine, then the report itself. Neither
 * decides anything, so a read-only page (no dashboard link) may prepare one. Nothing here posts
 * anything anywhere but this pxsig server.
 */
import { type Refusal, scope, withProject } from './request';

/** What the report's options ask for (`GET /__pxsig/gate-report`). */
export interface GateReportOptions {
  full: boolean;
  keepId: boolean;
  noImage: boolean;
}

/** `GET /__pxsig/gate-report`'s answer: the text, the link, the image as a PNG data URL. */
export interface GateReportAnswer {
  text: string;
  url: string;
  /** The form's fields cut to fit the link. */
  trimmed: string[];
  /** A PNG data URL; null for an image-free report. */
  image: string | null;
  facts: { image: { width: number; height: number } | null };
}

/** `POST /__pxsig/gate-report/self-check`'s answer. */
export interface SelfCheck {
  state: 'differs' | 'passes' | 'error' | 'not-checked';
  reasons?: string[];
  error?: string;
}

/** Re-render and check `id` on this machine; resolves when its run has ended. */
export async function selfCheck(id: string): Promise<SelfCheck> {
  const r = await fetch('/__pxsig/gate-report/self-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: withProject({ id }),
  });
  // The server's answer (server.md); a body that is not JSON reads as {}.
  const body = await (r.json() as Promise<SelfCheck & Refusal>).catch(
    () => ({}) as SelfCheck & Refusal
  );
  if (!r.ok || !body.state) throw new Error(body.error || r.statusText);
  return body;
}

/** The gate report of `id` with the options; nothing is written. */
export async function gateReport(id: string, o: GateReportOptions): Promise<GateReportAnswer> {
  const q = new URLSearchParams(scope().slice(1));
  q.set('id', id);
  if (o.full) q.set('full', '1');
  if (o.keepId) q.set('keepId', '1');
  if (o.noImage) q.set('noImage', '1');
  const r = await fetch(`/__pxsig/gate-report?${q}`, { cache: 'no-store' });
  // The server's answer, or a refusal (409: nothing to report); not JSON reads as {}.
  const body = await (r.json() as Promise<GateReportAnswer & Refusal>).catch(
    () => ({}) as GateReportAnswer & Refusal
  );
  if (!r.ok || typeof body.text !== 'string') throw new Error(body.error || r.statusText);
  return body;
}
