/**
 * lib/rejections/prompt.mjs — the words a rejection hands to whoever fixes the entry: the goal
 * line, the re-check command, how each `via` is named, and one paragraph for an assistant. One
 * template, so the packet (rejection.md, rejection.json), the CLI, MCP and the dashboard say the
 * same thing. Not configurable (docs/configuration.md#rejections). Neutral copy: no "you", no
 * questions; nothing here approves, and every form says so.
 */
import { NO_MASK_FIX } from '../assistants.mjs';
/** @import { RejectionKind } from '../../types/rejections.js' */

/** What a fix aims at. With no reason, the baseline; a reason decides, and the reviewer judges. */
export const GOAL = {
  visual: "what the reason asks; with no reason, restore the baseline's look",
  a11y: 'fix the violations',
};

/** Said wherever a rejection is handed on. */
export const NEVER_APPROVE = "Never approve: approving is the person's.";

/** In place of a reason, when none was given. */
export const NO_REASON = 'No reason given.';

/**
 * How a decision reached the server, in words: an assistant's note is never read as the
 * reviewer's.
 * @type {Record<string, string>}
 */
const VIA = {
  dashboard: 'the dashboard',
  cli: "the CLI's token",
  mcp: "mcp, an assistant at the person's request",
};

/** @param {string} via */
export const viaLabel = (via) => VIA[via] ?? via;

/**
 * The re-check command.
 * @param {string} id
 */
export const recheck = (id) => `pxsig check ${id}`;

/**
 * The packet's folder, store-relative: `reports/rejected/<id>/`, `<id>.a11y/` for accessibility.
 * @param {RejectionKind} kind
 * @param {string} id
 */
export const packetFolder = (kind, id) =>
  `reports/rejected/${id}${kind === 'a11y' ? '.a11y' : ''}/`;

/**
 * One paragraph for an assistant, for a paste or a session's start.
 * @param {{ id: string, project: string, kind: RejectionKind, note: string | null, store: string, packet: string | null }} r
 *   `store` workspace-relative, `packet` store-relative (null: none written)
 */
export function rejectionPrompt({ id, project, kind, note, store, packet }) {
  const where = packet
    ? `${[store, packet].filter(Boolean).join('/').replace(/\/+/g, '/')}rejection.md, or MCP pxsig_rejected`
    : 'MCP pxsig_rejected';
  return [
    `pxsig rejected ${id} (${project}${kind === 'a11y' ? ', accessibility' : ''}): "${note ?? NO_REASON}".`,
    `Goal: ${GOAL[kind]}.`,
    `Details${packet ? ' and images' : ''}: ${where}.`,
    `After the fix: ${recheck(id)}.`,
    'Never approve.',
    NO_MASK_FIX,
  ].join(' ');
}
