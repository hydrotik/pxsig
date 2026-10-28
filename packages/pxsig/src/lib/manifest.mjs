/**
 * manifest.mjs — manifest v2: every story × its modes × its interaction states.
 *
 * Story-level configuration lives in the CSF file, on a story or its meta:
 *
 *   parameters: {
 *     pxsig: {
 *       disable: true,                          // skip (or tag the story 'no-pxsig')
 *       modes: ['dark', 'light', 'mobile'],     // replace the default mode list
 *       addModes: ['lime'],                     // …or add to it
 *       gate: { threshold: 24, minCells: 3, detail: { minTiles: 4 } },
 *       grid: 96,                               // signature grid for this story
 *       detail: false,                          // no detail channel in its baselines
 *       ignore: ['[data-timestamp]', '.live'],  // masked out before every capture
 *       states: [                               // extra captures after an interaction
 *         { name: 'hover', action: 'hover', target: 'button' },
 *         { name: 'open', action: 'click', target: '[aria-haspopup]', waitFor: '[role="menu"]', fullPage: true },
 *         // actions: hover · focus · click · rightclick · press (key or [keys], on target)
 *         // fullPage: capture the viewport (popups portal outside the story root)
 *       ],
 *       delay: 400,                             // extra settle (ms)
 *       target: '#storybook-root',              // element to capture
 *       a11y: false,                            // skip the axe pass
 *     },
 *   }
 *
 * The parameters are read from the running Storybook (one page, the preview's
 * story store), so what the harness, CI and the addon see is exactly what the
 * CSF declares — no parsing of TypeScript.
 *
 * Entry keys: `<storyId>[__<state>][@<mode>]`; the default mode keeps the bare id,
 * so existing baselines keep their names.
 */
import { launchBrowser } from './capture.mjs';
/** @import { Browser } from 'playwright' */
/** @import { EntryConfig, ManifestEntry, Mode, ManifestSkipped, Project, StoryParameters, StoryPxsigParameters, StorybookPreviewWindow, StoryRef } from '../types.js' */

/**
 * Read parameters.pxsig, tags and play presence for every story id.
 * @param {Project} project
 * @param {string} baseUrl
 * @param {string[]} ids
 * @param {{ browser?: Browser }} [opts]
 * @returns {Promise<Record<string, StoryParameters>>}
 */
export async function harvestParameters(project, baseUrl, ids, { browser: given } = {}) {
  const browser = given ?? (await launchBrowser(project));
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/iframe.html?id=${encodeURIComponent(ids[0])}&viewMode=story`, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    return await page.evaluate(async (/** @type {string[]} */ list) => {
      // Runs in the story page: Storybook's preview is on its window.
      const pv = /** @type {StorybookPreviewWindow} */ (window).__STORYBOOK_PREVIEW__;
      await pv.storeInitializationPromise;
      const store = pv.storyStoreValue;
      /** @type {Record<string, StoryParameters>} */
      const out = {};
      for (let i = 0; i < list.length; i += 32) {
        await Promise.all(
          list.slice(i, i + 32).map(async (id) => {
            try {
              const s = await store.loadStory({ storyId: id });
              // JSON round-trip drops functions; pxsig parameters are plain data.
              out[id] = {
                // The story's own `parameters.pxsig`, in the shape the header above documents.
                pxsig: /** @type {StoryPxsigParameters} */ (
                  JSON.parse(JSON.stringify(s.parameters?.pxsig ?? {}))
                ),
                tags: s.tags ?? [],
                play: !!s.playFunction,
              };
            } catch (e) {
              out[id] = {
                pxsig: {},
                tags: [],
                play: false,
                error: String(/** @type {Error | undefined} */ (e)?.message ?? e),
              };
            }
          })
        );
      }
      return out;
    }, ids);
  } finally {
    if (!given) await browser.close();
  }
}

/**
 * @param {string} id
 * @param {string | null | undefined} state
 * @param {string | null | undefined} mode
 * @param {string | null | undefined} defaultMode
 */
const keyOf = (id, state, mode, defaultMode) =>
  `${id}${state ? `__${state}` : ''}${mode && mode !== defaultMode ? `@${mode}` : ''}`;

/**
 * Expand stories into manifest entries.
 * stories: [{ id, importPath, sigFor(key) }]; params: harvestParameters output.
 * Options: `modes` keeps only these modes; `addModes` adds modes to every story
 * (e.g. a cross-browser or mobile matrix run).
 * @param {EntryConfig} config
 * @param {StoryRef[]} stories
 * @param {Record<string, StoryParameters>} params
 * @param {{ modes?: string[], addModes?: string[] }} [opts]
 * @returns {{ entries: ManifestEntry[], skipped: ManifestSkipped[], defaultMode: string }}
 */
export function expandEntries(config, stories, params, opts = {}) {
  /** @type {Record<string, Mode>} */
  const modes = config.modes ?? {
    dark: { globals: config.globals ?? '', colorScheme: config.colorScheme ?? 'dark' },
  };
  const defaultMode = config.defaultMode ?? Object.keys(modes)[0];
  const byDefault = config.modesByDefault ?? [defaultMode];
  /** @type {ManifestEntry[]} */
  const entries = [];
  /** @type {ManifestSkipped[]} */
  const skipped = [];
  for (const s of stories) {
    /** @type {StoryParameters} */
    const p = params[s.id] ?? { pxsig: {}, tags: [] };
    const px = p.pxsig ?? {};
    if (px.disable || p.tags?.includes('no-pxsig')) {
      skipped.push({
        id: s.id,
        reason: px.disable ? 'parameters.pxsig.disable' : "tag 'no-pxsig'",
      });
      continue;
    }
    let list = Array.isArray(px.modes)
      ? px.modes
      : [...byDefault, ...(px.addModes ?? []), ...(opts.addModes ?? [])];
    list = [...new Set(list)].filter((m) => modes[m]);
    // `opts.modes` was checked just before.
    if (opts.modes) list = list.filter((m) => /** @type {string[]} */ (opts.modes).includes(m));
    const states = [null, ...(Array.isArray(px.states) ? px.states : [])];
    for (const mode of list) {
      const md = modes[mode];
      for (const st of states) {
        const key = keyOf(s.id, st?.name, mode, defaultMode);
        entries.push({
          id: key,
          story: s.id,
          mode,
          state: st?.name ?? null,
          sig: s.sigFor(key),
          importPath: s.importPath,
          globals: md.globals ?? config.globals ?? '',
          colorScheme: md.colorScheme ?? config.colorScheme ?? 'dark',
          viewport: px.viewport ?? md.viewport ?? config.viewport ?? [900, 600],
          browser: md.browser ?? 'chromium',
          ...(px.grid ? { grid: px.grid } : {}),
          ...(px.gate ? { gate: px.gate } : {}),
          ...(px.detail === false ? { detail: false } : {}),
          ...(px.ignore?.length ? { ignore: px.ignore } : {}),
          ...(st ? { interaction: st } : {}),
          ...(px.delay ? { delay: px.delay } : {}),
          ...(px.target ? { target: px.target } : {}),
          ...(p.play ? { play: true } : {}),
          a11y: px.a11y !== false && config.a11y !== false,
        });
      }
    }
  }
  return { entries, skipped, defaultMode };
}
