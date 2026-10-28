#!/usr/bin/env node
/**
 * check-links.mjs — every relative link in the tracked Markdown resolves.
 *
 *   node scripts/check-links.mjs
 *
 * For each tracked `.md` file: inline links and images (`[t](path#anchor)`), reference
 * definitions (`[t]: path`) and `href`/`src` attributes. A relative path must name a tracked file
 * or folder; an `#anchor` into a Markdown file (or the file itself) must be one of its headings, as
 * GitHub writes their ids, or an `id`/`name` it declares. Links with a scheme (`https:`, `mailto:`),
 * protocol-relative and root-absolute links are not checked; neither is anything inside code.
 * Exit: 0 all resolve · 1 a broken link (each one named, with its line).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * GitHub's id for a heading's text: lower case, inline Markdown dropped, punctuation removed,
 * spaces to dashes.
 * @param {string} text
 */
export function slug(text) {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/ /g, '-');
}

/**
 * The lines outside fenced code blocks, as [line number, text with inline code spans blanked,
 * text as written].
 * @param {string} text
 * @returns {[number, string, string][]}
 */
function proseLines(text) {
  /** @type {[number, string, string][]} */
  const out = [];
  /** @type {string | null} */
  let fence = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0].repeat(f[1].length);
      else if (f[1].startsWith(fence)) fence = null;
      return;
    }
    if (fence === null)
      out.push([i + 1, line.replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length)), line]);
  });
  return out;
}

/**
 * The anchors a Markdown file defines: its headings' ids (repeats numbered as GitHub does) and
 * any `id="…"` or `name="…"`.
 * @param {string} text
 */
export function anchors(text) {
  /** @type {Set<string>} */
  const out = new Set();
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const [, line, raw] of proseLines(text)) {
    // The heading as written: an id keeps the text of its code spans (`### \`env\`` is #env).
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) {
      const base = slug(h[1]);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.add(n ? `${base}-${n}` : base);
    }
    for (const m of line.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) out.add(m[1]);
  }
  return out;
}

/**
 * Every link target in a Markdown file's prose, with its line.
 * @param {string} text
 * @returns {{ line: number, target: string }[]}
 */
export function links(text) {
  /** @type {{ line: number, target: string }[]} */
  const out = [];
  for (const [line, s] of proseLines(text)) {
    for (const m of s.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g))
      out.push({ line, target: m[1].replace(/^<|>$/g, '') });
    const def = /^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/.exec(s);
    if (def) out.push({ line, target: def[1].replace(/^<|>$/g, '') });
    for (const m of s.matchAll(/\b(?:href|src)=["']([^"']+)["']/g))
      out.push({ line, target: m[1] });
  }
  return out;
}

/**
 * The broken links in a set of files: `{ path: text }` for the Markdown, and every tracked path
 * (files; their folders count too).
 * @param {Map<string, string>} markdown
 * @param {Set<string>} tracked
 */
export function brokenLinks(markdown, tracked) {
  /** @type {Set<string>} */
  const folders = new Set();
  for (const f of tracked) {
    let d = posix.dirname(f);
    while (d !== '.' && !folders.has(d)) {
      folders.add(d);
      d = posix.dirname(d);
    }
  }
  /** @type {Map<string, Set<string>>} */
  const anchorCache = new Map();
  /** @param {string} f */
  const anchorsOf = (f) => {
    let a = anchorCache.get(f);
    if (!a) anchorCache.set(f, (a = anchors(markdown.get(f) ?? '')));
    return a;
  };
  /** @type {string[]} */
  const problems = [];
  for (const [file, text] of markdown) {
    for (const { line, target } of links(text)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
      const hash = target.indexOf('#');
      const rawPath = hash < 0 ? target : target.slice(0, hash);
      const anchor = hash < 0 ? null : target.slice(hash + 1);
      let path;
      try {
        path = decodeURIComponent(rawPath.split('?')[0]);
      } catch {
        problems.push(`${file}:${line}: ${target}: not a valid address`);
        continue;
      }
      const to = path
        ? posix.normalize(posix.join(posix.dirname(file), path)).replace(/\/$/, '')
        : file;
      if (to.startsWith('..') || (!tracked.has(to) && !folders.has(to) && to !== '.')) {
        problems.push(`${file}:${line}: ${target}: no such file`);
        continue;
      }
      if (
        anchor &&
        markdown.has(to) &&
        !anchorsOf(to).has(decodeURIComponent(anchor).toLowerCase())
      )
        problems.push(`${file}:${line}: ${target}: no heading or id "${anchor}" in ${to}`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const tracked = new Set(
    execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
  );
  /** @type {Map<string, string>} */
  const markdown = new Map();
  for (const f of tracked)
    if (f.endsWith('.md')) {
      try {
        markdown.set(f, readFileSync(resolve(root, f), 'utf8'));
      } catch {
        /* deleted in the working tree */
      }
    }
  const problems = brokenLinks(markdown, tracked);
  if (problems.length) {
    console.error(`[check-links] ${problems.length} broken link(s):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`[check-links] ok · ${markdown.size} Markdown files, every relative link resolves`);
}
