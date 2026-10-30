/** Register (repair.mjs): sync the manifest from the story index; new entries are unbaselined. */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { componentOf, readJson, writeJsonAtomic } from '../integrity.mjs';
import { guardWrite, logRepair, who } from './core.mjs';
/** @import { IntegrityContext } from '../integrity.mjs' */
/** @import { IndexStory, StoryRef } from '../../types.js' */
/** @import { NamedIndex, Harvest, IntegrityManifest, RegisterResult, RepairActor, StoryToRegister } from '../../types/t3.js' */

// --- register: sync the manifest from the story index ------------------------------------------------------

/**
 * Add stories to the manifest. Existing entries are untouched (same objects, same order); new
 * entries go after the last entry of their story file. The previous manifest is kept in
 * `<store>/reports/manifest-history/`. Baselines are never created: new entries are unbaselined.
 * @param {IntegrityContext} ctx
 * @param {StoryToRegister[]} stories
 * @param {{ harvest: Harvest }} hooks
 * @returns {Promise<RegisterResult>}
 */
export async function registerStories(ctx, stories, { harvest }) {
  const { expandEntries } = await import('../manifest.mjs');
  const { entryConfig } = await import('../workspace.mjs');
  // The manifest `pxsig manifest` wrote (docs/spec.md section 6).
  const manifest = /** @type {IntegrityManifest} */ (readJson(ctx.manifestPath, null));
  const have = new Set(manifest.stories.map((e) => e.story ?? e.id));
  const asked = stories.filter((s) => !have.has(s.id));
  if (!asked.length) return { added: [], skipped: [], failed: [], adoptedSignatures: [] };
  const params = await harvest(asked.map((s) => s.id));
  // A story whose parameters cannot be read is left out (and reported), not the whole step.
  const failed = asked
    .filter((s) => params[s.id]?.error)
    .map((s) => ({ id: s.id, why: `could not read parameters: ${params[s.id].error}` }));
  const todo = asked.filter((s) => !params[s.id]?.error);
  if (!todo.length) return { added: [], skipped: [], failed, adoptedSignatures: [] };
  /** @type {StoryRef[]} */
  const list = todo.map((s) => ({
    id: s.id,
    importPath: s.importPath,
    sigFor: (key) => ctx.project.sigFor(key, s.importPath),
  }));
  const { entries, skipped } = expandEntries(entryConfig(ctx.project), list, params);
  const ids = new Set(manifest.stories.map((e) => e.id));
  const fresh = entries.filter((e) => !ids.has(e.id));
  // An old signature at a new entry's path (a story renamed back) is adopted, not trusted blindly: logged.
  const adoptedSignatures = fresh
    .filter((e) => existsSync(resolve(ctx.repoRoot, e.sig)))
    .map((e) => e.id);
  const stories2 = [...manifest.stories];
  for (const e of fresh) {
    let at = -1;
    for (let i = 0; i < stories2.length; i++) if (stories2[i].importPath === e.importPath) at = i;
    if (at === -1) stories2.push(e);
    else stories2.splice(at + 1, 0, e);
  }
  const newSkips = skipped.filter((s) => !(manifest.skipped ?? []).some((x) => x.id === s.id));
  if (!fresh.length && !newSkips.length) return { added: [], skipped, failed, adoptedSignatures };
  const backupDir = guardWrite(ctx, join(ctx.dirs.reports, 'manifest-history'));
  mkdirSync(backupDir, { recursive: true });
  const backup = join(backupDir, `manifest.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  copyFileSync(ctx.manifestPath, guardWrite(ctx, backup));
  const next = {
    ...manifest,
    skipped: [...(manifest.skipped ?? []), ...newSkips],
    stories: stories2,
  };
  writeJsonAtomic(guardWrite(ctx, ctx.manifestPath), next, { pretty: true });
  return {
    added: fresh.map((e) => e.id),
    skipped,
    failed,
    adoptedSignatures,
    backup: relative(ctx.repoRoot, backup),
  };
}

/**
 * The entry ids of `story` among `ids` (`<story>`, `<story>__<state>`, `<story>@<mode>`).
 * @param {string[]} ids
 * @param {string} story
 */
export const entriesOfStory = (ids, story) =>
  ids.filter((e) => e === story || e.startsWith(`${story}__`) || e.startsWith(`${story}@`));

/**
 * The story id an entry id belongs to: `<story>[__<state>][@<mode>]` → `<story>`.
 * @param {unknown} id
 */
export const storyOfEntry = (id) => String(id).replace(/(__[^@]+)?(@.+)?$/, '');

/**
 * Log a register run: one line per story, plus one per adopted signature and per failure.
 * @param {IntegrityContext} ctx
 * @param {RegisterResult} r
 * @param {string[]} storyIds
 * @param {RepairActor & { why?: string }} actor
 */
export function logRegister(
  ctx,
  r,
  storyIds,
  { by, via, why = 'unregistered: in the story index, not in the manifest' }
) {
  const failed = new Map(r.failed.map((f) => [f.id, f.why]));
  const skipped = new Map(r.skipped.map((s) => [s.id, s.reason]));
  for (const id of storyIds) {
    if (failed.has(id))
      logRepair(ctx, {
        by,
        via,
        action: 'register',
        id,
        why,
        result: 'failed',
        error: failed.get(id),
      });
    else if (skipped.has(id))
      logRepair(ctx, {
        by,
        via,
        action: 'register',
        id,
        why,
        result: `skipped: ${skipped.get(id)}`,
      });
    else
      logRepair(ctx, {
        by,
        via,
        action: 'register',
        id,
        why,
        result: 'added to the manifest without a signature (NEW, needs approval)',
        entries: entriesOfStory(r.added, id),
      });
  }
  // An existing file at a new entry's signature path becomes its baseline as it is: say so.
  for (const id of r.adoptedSignatures)
    logRepair(ctx, {
      by,
      via,
      action: 'register',
      id,
      why: "a signature already existed at the new entry's path (a story renamed back?)",
      result: 'adopted the existing signature unchanged: review it like any baseline',
    });
}

/**
 * Register the stories a selection names but the manifest does not have (`pxsig check --only`,
 * the server queue, the MCP), so checking a new story is one step. `names` are story ids or entry
 * ids; `index` is a loadStoryIndex() result. Needs a healthy Storybook (parameters are read from
 * it). Never writes a signature: the entries arrive NEW, for a person to approve.
 * Returns { added: entry ids, stories: story ids registered, skipped: [{ name, why }] }.
 * @param {IntegrityContext} ctx
 * @param {Iterable<string>} names
 * @param {{ index?: NamedIndex | null, harvest: Harvest, by?: string | null, via?: string }} opts
 * @returns {Promise<{ added: string[], stories: string[], skipped: { name: string, why: string }[], adoptedSignatures?: string[] }>}
 */
export async function registerNamed(ctx, names, { index, harvest, by = who(ctx), via = 'check' }) {
  // The manifest `pxsig manifest` wrote (docs/spec.md section 6).
  const manifest = /** @type {IntegrityManifest} */ (readJson(ctx.manifestPath, null));
  const entryIds = new Set(manifest.stories.map((e) => e.id));
  const storyIds = new Set(manifest.stories.map((e) => e.story ?? e.id));
  /** @type {{ name: string, why: string }[]} */
  const skipped = [];
  /** @type {Map<string, string[]>} */
  const want = new Map(); // story id → names asking for it
  const nonVisual = new Set(ctx.config.nonVisual ?? []);
  const excludedBy = new Map((manifest.skipped ?? []).map((s) => [s.id, s.reason]));
  const live = index?.source === 'storybook';
  const byId = new Map((index?.stories ?? []).map((s) => [s.id, s]));
  for (const name of new Set(names)) {
    if (entryIds.has(name) || storyIds.has(name)) continue;
    const story = byId.has(name) ? name : storyOfEntry(name);
    if (storyIds.has(story)) {
      skipped.push({
        name,
        why: `no such entry: story ${story} is registered with ${entriesOfStory([...entryIds], story).join(', ') || 'no entries'}`,
      });
      continue;
    }
    if (!live) {
      skipped.push({
        name,
        why: `not in the manifest, and registering it needs a running, healthy Storybook (${index?.storybook?.error ?? 'index not loaded'})`,
      });
      continue;
    }
    const s = byId.get(story);
    const component = s ? componentOf(ctx, s.importPath) : null;
    if (!s) skipped.push({ name, why: 'not in the manifest or the Storybook story index' });
    else if (component == null)
      skipped.push({ name, why: `outside the project's srcRoot (${s.importPath})` });
    else if (nonVisual.has(component.split('/')[0]))
      skipped.push({
        name,
        why: `excluded: folder "${component.split('/')[0]}" is listed in config.nonVisual`,
      });
    else if (excludedBy.has(story))
      skipped.push({ name, why: `excluded: ${excludedBy.get(story)}` });
    else if ((s.tags ?? []).includes('no-pxsig'))
      skipped.push({ name, why: "excluded: tag 'no-pxsig'" });
    else want.set(story, [...(want.get(story) ?? []), name]);
  }
  if (!want.size) return { added: [], stories: [], skipped };
  const r = await registerStories(
    ctx,
    // Every story in `want` was found in the index (`s` above).
    [...want.keys()].map((id) => ({
      id,
      importPath: /** @type {IndexStory} */ (byId.get(id)).importPath,
    })),
    { harvest }
  );
  logRegister(ctx, r, [...want.keys()], {
    by,
    via,
    why: `named by ${via} but not in the manifest`,
  });
  for (const f of r.failed)
    for (const name of want.get(f.id) ?? []) skipped.push({ name, why: f.why });
  for (const x of r.skipped)
    for (const name of want.get(x.id) ?? []) skipped.push({ name, why: `excluded: ${x.reason}` });
  // An entry id that names a mode or state the story does not have.
  for (const [story, asked] of want)
    for (const name of asked)
      if (name !== story && !r.added.includes(name) && entriesOfStory(r.added, story).length)
        skipped.push({
          name,
          why: `no such entry: story ${story} was registered with ${entriesOfStory(r.added, story).join(', ')}`,
        });
  const added = r.added;
  return {
    added,
    stories: [...want.keys()].filter((id) => entriesOfStory(added, id).length),
    skipped,
    adoptedSignatures: r.adoptedSignatures,
  };
}
