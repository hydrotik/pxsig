/**
 * md-relink.mjs — the relative links in Markdown, rewritten for the file's new folder.
 *
 * A release moves each changelog.d/ fragment's text into CHANGELOG.md at the top of the checkout
 * (scripts/changelog.mjs), so a link written from the fragment (`../docs/integrity.md#drift`) must
 * become one from the root (`docs/integrity.md#drift`). `relink` rewrites the target of every
 * inline link and image (`](target)`, with or without a title) and every reference definition
 * (`[id]: target`). A URL (`https:`, `mailto:`), an anchor in the same file (`#…`) and a path from
 * the site root (`/…`) are left as they are. Zero dependencies.
 */
import { posix } from 'node:path';

// `](target` of an inline link or image; the target ends at whitespace (a title) or `)`.
const INLINE = /\]\(([^)\s]+)/g;
// `[id]: target` at the start of a line.
const DEFINITION = /^( {0,3}\[[^\]]+\]:\s*)(\S+)/gm;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i;

/**
 * @param {string} text Markdown
 * @param {{ from: string, to: string }} dirs the folder the text was written in and the folder it
 *   moves to, both relative to the repository's top, posix-style (`changelog.d`, `''` for the top)
 * @returns {string}
 */
export function relink(text, { from, to }) {
  if (posix.normalize(from || '.') === posix.normalize(to || '.')) return text;
  /** @param {string} href */
  const move = (href) => {
    if (EXTERNAL.test(href)) return href;
    const i = href.indexOf('#');
    const path = i < 0 ? href : href.slice(0, i);
    if (!path) return href;
    const target = posix.join(from || '.', path);
    const rel = posix.relative(to || '.', target) || '.';
    return `${rel}${i < 0 ? '' : href.slice(i)}`;
  };
  return text
    .replace(INLINE, (/** @type {string} */ _, /** @type {string} */ href) => `](${move(href)}`)
    .replace(
      DEFINITION,
      (/** @type {string} */ _, /** @type {string} */ lead, /** @type {string} */ href) =>
        `${lead}${move(href)}`
    );
}
