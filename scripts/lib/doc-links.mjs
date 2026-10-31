/**
 * doc-links.mjs — the links in a packed Markdown file, pinned to the release it ships in.
 *
 * npm shows a package's README at the version installed, so a link to a document on `main` can
 * describe features that version does not have, and a relative link that leaves the package
 * (`../../docs/server.md`) leads nowhere on npm or in node_modules. `versionLinks` rewrites both to
 * `https://github.com/hydrotik/pxsig/blob/v<version>/…`; a relative link to a file the package
 * holds stays relative. `leftLinks` lists what a packed file still has of either kind.
 *
 * Used by pack-manifest.mjs (each package's README) and sync-dashboard-source.mjs (the Markdown it
 * copies into pxsig). Zero dependencies.
 */
import { posix } from 'node:path';

export const REPO_URL = 'https://github.com/hydrotik/pxsig';
const ON_MAIN = /https:\/\/github\.com\/hydrotik\/pxsig\/(blob|tree)\/main\//g;
// `](target)`: an inline link or image. A target with a title (`](x "t")`) is left as it is.
const LINK = /\]\(([^)\s]+)\)/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i;

/**
 * @param {string} href
 * @returns {[string, string]} the path and its `#fragment` ('' when none)
 */
const split = (href) => {
  const i = href.indexOf('#');
  return i < 0 ? [href, ''] : [href.slice(0, i), href.slice(i)];
};

/**
 * @param {string} text Markdown
 * @param {{ version: string, source: string, held: (path: string) => boolean }} o
 *   `source`: the file's path in the repository (`packages/dashboard/README.md`); `held(path)`:
 *   whether the package holds a relative link's path, as written in the file
 * @returns {string}
 */
export function versionLinks(text, { version, source, held }) {
  const ref = `v${version}`;
  /** @type {(whole: string, href: string) => string} */
  const pin = (whole, href) => {
    const [path, hash] = split(href);
    if (EXTERNAL.test(href) || !path || held(path)) return whole;
    const target = posix.normalize(posix.join(posix.dirname(source), path));
    // Outside the repository: nothing on GitHub to point at.
    if (target.startsWith('../')) return whole;
    return `](${REPO_URL}/blob/${ref}/${target}${hash})`;
  };
  return text.replace(ON_MAIN, `${REPO_URL}/$1/${ref}/`).replace(LINK, pin);
}

/**
 * What a packed Markdown file still links to that a reader of the package cannot follow at its
 * version: pxsig's `main`, or a relative path the package does not hold.
 * @param {string} text
 * @param {(path: string) => boolean} held
 * @returns {string[]}
 */
export function leftLinks(text, held) {
  const out = [...text.matchAll(ON_MAIN)].map((m) => m[0]);
  for (const [, href] of text.matchAll(LINK)) {
    const [path] = split(href);
    if (!EXTERNAL.test(href) && path && !held(path)) out.push(href);
  }
  return out;
}
