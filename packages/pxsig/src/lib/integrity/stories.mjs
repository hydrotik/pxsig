/** Storybook ids and the story index (integrity.mjs): fetched when healthy, else scanned. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { toPosix } from '../paths.mjs';
/** @import { IndexStory, StoryIndex } from '../../types.js' */
/** @import { FetchLike, FetchedIndex, StorybookIndexEntry, StorybookIndexJson } from '../../types/t3.js' */
/** @import { IntegrityContext } from './context.mjs' */

// --- Storybook ids (the rules of @storybook/csf) -----------------------------------------------------

/**
 * Storybook's `sanitize`: lower-case, punctuation and spaces → '-', runs collapsed, ends trimmed.
 * @param {unknown} s
 */
export const sanitize = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[ ’–—―′¿'`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

/**
 * lodash `startCase`, as Storybook's `storyNameFromExport` uses it: `Virtualised100K` → `Virtualised 100 K`.
 * @param {unknown} key
 */
export const storyNameFromExport = (key) =>
  String(key)
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/**
 * Storybook's `toId(kind, name)`.
 * @param {unknown} title
 * @param {unknown} name
 */
export const toId = (title, name) => `${sanitize(title)}--${sanitize(name)}`;

// --- the story index ------------------------------------------------------------------------------

/**
 * Normalise an index.json importPath (relative to the Storybook config dir) to repo-relative.
 * @param {IntegrityContext} ctx
 * @param {string} p
 */
export function normaliseImportPath(ctx, p) {
  if (!p) return p;
  if (ctx.config.storybookDir)
    return toPosix(relative(ctx.repoRoot, resolve(ctx.repoRoot, ctx.config.storybookDir, p)));
  const stripped = p.replace(/^(\.\.?\/)+/, '');
  return existsSync(resolve(ctx.repoRoot, stripped))
    ? stripped
    : toPosix(relative(ctx.repoRoot, resolve(ctx.repoRoot, p)));
}

/** @param {IntegrityContext} ctx */
const scopeRe = (ctx) =>
  new RegExp(
    ctx.config.importPathPattern ??
      `${ctx.srcRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(.+)/[^/]+\\.stories\\.[jt]sx?$`
  );

/**
 * The storied folder (component) an importPath belongs to, or null when outside scope.
 * @param {IntegrityContext} ctx
 * @param {string | null | undefined} importPath
 * @returns {string | null}
 */
export function componentOf(ctx, importPath) {
  if (!importPath) return null;
  const m = importPath.match(scopeRe(ctx));
  if (!m) return null;
  return m[1] ?? toPosix(dirname(relative(ctx.srcRoot, importPath)));
}

/**
 * Fetch `<baseUrl>/index.json`. `reachable` = something answered; `healthy` = it is a v4/v5
 * index with entries. Storybook answers a broken build (e.g. "Unable to index files") with an
 * error, which is not an index: callers must not render against it.
 * @param {unknown} baseUrl
 * @param {{ timeoutMs?: number, fetchImpl?: FetchLike }} [opts]
 * @returns {Promise<FetchedIndex>}
 */
export async function fetchStoryIndex(
  baseUrl,
  { timeoutMs = 4000, fetchImpl = globalThis.fetch } = {}
) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/index.json`;
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return {
      url,
      reachable: false,
      healthy: false,
      // fetch rejects with an Error: a TypeError with the socket error as `cause`, or an AbortError.
      error: `unreachable: ${/** @type {Error & { cause?: { code?: string } }} */ (e).cause?.code ?? /** @type {Error} */ (e).message}`,
    };
  }
  const body = await res.text().catch(() => '');
  /** @type {StorybookIndexJson | null} */
  let json = null;
  try {
    // Any JSON value: only `entries` is read, and it is checked next.
    json = /** @type {StorybookIndexJson | null} */ (JSON.parse(body));
  } catch {
    /* not JSON: an error page */
  }
  if (!res.ok || !json || typeof json.entries !== 'object' || json.entries === null) {
    const msg = body
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    return {
      url,
      reachable: true,
      healthy: false,
      status: res.status,
      error: `broken index (HTTP ${res.status}): ${msg || 'not a story index'}`,
    };
  }
  // A v4/v5 index: `entries` holds its story and docs records.
  const stories = Object.values(/** @type {Record<string, StorybookIndexEntry>} */ (json.entries))
    .filter((e) => e.type === 'story')
    .map((e) => ({
      id: e.id,
      title: e.title,
      name: e.name,
      importPath: e.importPath,
      tags: e.tags ?? [],
    }));
  return { url, reachable: true, healthy: true, version: json.v ?? null, stories };
}

/**
 * Strip comments so a commented-out `export const` is not a story.
 * @param {string} src
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

/**
 * Static fallback: scan `*.stories.{tsx,ts,jsx,js}` under srcRoot. Title from the default export's
 * meta (`title: '…'`), else inferred from the path; story ids by Storybook's rules
 * (`toId(title, storyNameFromExport(exportName))`).
 * @param {IntegrityContext} ctx
 * @returns {IndexStory[]}
 */
export function scanStories(ctx) {
  const root = resolve(ctx.repoRoot, ctx.srcRoot);
  /** @type {IndexStory[]} */
  const out = [];
  if (!existsSync(root)) return out;
  /** @param {string} dir */
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (
        d.name.startsWith('.') ||
        ['node_modules', 'dist', 'build', ctx.pixelsDir].includes(d.name)
      )
        continue;
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.stories\.[jt]sx?$/.test(d.name)) {
        const src = stripComments(readFileSync(p, 'utf8'));
        const importPath = toPosix(relative(ctx.repoRoot, p));
        const metaAt = Math.max(0, src.search(/export\s+default\b|const\s+meta\b/));
        const t = src.slice(metaAt).match(/\btitle\s*:\s*(['"`])((?:(?!\1).)+)\1/);
        const title = t
          ? t[2]
          : toPosix(relative(root, p))
              .replace(/\.stories\.[jt]sx?$/, '')
              .replace(/\/index$/, '');
        for (const m of src.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/gm)) {
          if (m[1] === '__namedExportsOrder') continue;
          const name = storyNameFromExport(m[1]);
          out.push({
            id: toId(title, name),
            title,
            name,
            exportName: m[1],
            importPath,
            titleSource: t ? 'meta' : 'inferred',
          });
        }
      }
    }
  };
  walk(root);
  return out;
}

/**
 * The story index to reconcile against: live when healthy, else the static scan.
 * @param {IntegrityContext} ctx
 * @param {{ fetchImpl?: FetchLike, offline?: boolean, live?: FetchedIndex | null }} [opts]
 * @returns {Promise<StoryIndex>}
 */
export async function loadStoryIndex(ctx, { fetchImpl, offline = false, live } = {}) {
  const baseUrl = ctx.config.baseUrl ?? 'http://localhost:6006';
  /** @type {FetchedIndex} */
  const res =
    live ??
    (offline
      ? {
          url: `${baseUrl}/index.json`,
          reachable: false,
          healthy: false,
          error: 'offline (not fetched)',
        }
      : await fetchStoryIndex(baseUrl, { timeoutMs: ctx.integrity.indexTimeoutMs, fetchImpl }));
  if (res.healthy) {
    const stories = res.stories.map((s) => ({
      ...s,
      importPath: normaliseImportPath(ctx, s.importPath),
    }));
    return {
      source: 'storybook',
      storybook: { url: res.url, reachable: true, healthy: true, version: res.version },
      stories,
    };
  }
  return {
    source: 'static',
    storybook: { url: res.url, reachable: res.reachable, healthy: false, error: res.error },
    stories: scanStories(ctx),
  };
}
