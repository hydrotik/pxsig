/**
 * check/prepare.mjs — before rendering: the store lock (or the run handed to the server that holds
 * it), a Storybook that answers with a healthy index, the `--only` names registered, the render
 * environments and `--strict-env`.
 */
import { resolve } from 'node:path';
import { browserPool } from '../lib/capture.mjs';
import { fetchStoryIndex, loadStoryIndex, resolveContext } from '../lib/integrity.mjs';
import { describeLock, readLock, takeLock } from '../lib/lock.mjs';
import { harvestParameters } from '../lib/manifest.mjs';
import { registerNamed } from '../lib/repair.mjs';
import { ensureStorybook } from '../lib/static.mjs';
import { PXSIG_VERSION, writeRunManifest } from '../lib/workspace.mjs';
import { envConfig, strictEnvCheck, strictFromEnv } from '../lib/env.mjs';
import { viaServer } from './via-server.mjs';
/** @import { CheckSetup, Die } from './setup.mjs' */
/** @import { Selection } from './select.mjs' */
/** @import { EnvRecord } from '../types.js' */

/** @typedef {Awaited<ReturnType<typeof prepare>>} Prepared */

/**
 * @param {CheckSetup} S
 * @param {Selection} sel
 */
export async function prepare(S, sel) {
  const { P, flags, suite, manifest, manifestPath, rust, enf } = S;
  const { entries, selected, unregistered, only, modes } = sel;
  /** @type {Die} */
  const die = S.die;
  // --- one writer per store: take the lock, or hand the run to the server that holds it ----------------
  const held = readLock(P);
  if (held && !held.stale && held.holder === 'serve' && !held.foreign) {
    if (flags.update || suite || flags['no-server'])
      die(
        `${describeLock(P, held)}: ${flags.update ? '--update' : suite ? '--suite' : 'this check'} cannot run beside it. Approve in the dashboard, or stop the server and run again.`
      );
    await viaServer(S, held.url ?? P.serverUrl(), [...selected], unregistered);
  }
  let lock;
  try {
    lock = await takeLock(P, { holder: flags.update ? 'check --update' : 'check' });
  } catch (e) {
    // takeLock throws an Error with the exit code to take (`exit`) when another writer holds the store.
    console.error(`[check] ${/** @type {Error & { exit?: number }} */ (e).message}`);
    process.exit(/** @type {Error & { exit?: number }} */ (e).exit ?? 2);
  }
  /** Before each batch of store writes: stop if the lock was taken over meanwhile. */
  const fence = () => {
    try {
      lock.check();
    } catch (e) {
      // `check` throws an Error saying who took the lock over.
      die(/** @type {Error} */ (e).message);
    }
  };

  // --- guard: never render against a broken Storybook ------------------------------------------
  // A failing index (e.g. "Unable to index files") makes every iframe show Storybook's error page;
  // recording those as renders turns a setup problem into hundreds of bogus diffs or baselines.
  if (entries.length || unregistered.length) {
    const sb = await ensureStorybook(P, { log: (m) => console.log(`[check] ${m}`) });
    manifest.baseUrl = P.storybook.url;
    if (sb.served) process.once('exit', () => sb.close());
  }
  const sbIndex =
    entries.length || unregistered.length ? await fetchStoryIndex(manifest.baseUrl) : null;
  if (sbIndex && !sbIndex.reachable)
    die(
      `setup error: Storybook is not reachable at ${manifest.baseUrl} (${sbIndex.error}); start it, point storybook.url at a running build, or set storybook.staticDir to a built Storybook. Nothing was rendered.`
    );
  if (sbIndex && !sbIndex.healthy)
    die(
      `setup error: Storybook's story index is broken — ${sbIndex.error}. Nothing was rendered or recorded; fix the index (see the Storybook terminal) and re-run.`
    );
  if (unregistered.length) {
    const ctx = resolveContext(P, { manifestPath });
    const reg = await registerNamed(ctx, unregistered, {
      index: await loadStoryIndex(ctx, { live: sbIndex }),
      harvest: (/** @type {string[]} */ ids) => harvestParameters(P, manifest.baseUrl, ids),
      via: 'check',
    });
    for (const x of reg.skipped) console.log(`[check] not checked: ${x.name}: ${x.why}`);
    if (reg.added.length) {
      console.log(
        `[check] registered ${reg.stories.join(', ')}: ${reg.added.length} NEW entries (no signature: a person approves their first render)`
      );
      Object.assign(manifest, writeRunManifest(P, manifestPath).manifest);
      for (const e of manifest.stories)
        if (
          reg.added.includes(e.id) &&
          (!modes || modes.includes(e.mode ?? manifest.defaultMode)) &&
          // `unregistered` holds --only names, so --only is set here.
          (/** @type {string[]} */ (only).includes(e.id) ||
            /** @type {string[]} */ (only).includes(e.story))
        ) {
          entries.push(e);
          selected.add(e.id);
        }
    }
    if (!entries.length)
      die(`no entries selected (${reg.skipped.map((x) => `${x.name}: ${x.why}`).join('; ')})`);
  }

  // --- the render environment, and --strict-env ---------------------------------------------------
  const envCfg = envConfig(P.config);
  const pool = browserPool(P);
  const engineVersion = (rust(['--version']).out.match(/(\d+\.\d+\.\d+\S*)/) ?? [])[1] ?? null;
  /** @type {Record<string, EnvRecord>} */
  const current = entries.length
    ? await pool.envs(
        entries.map((e) => e.browser ?? 'chromium'),
        { fontProbe: envCfg.fontProbe, pxsig: PXSIG_VERSION, engine: engineVersion }
      )
    : {};
  const strictEnv =
    !flags.update && (flags['strict-env'] === true || envCfg.strict || strictFromEnv());
  // The env gate under warn: the run renders anyway and reports what --strict-env would have refused.
  let envRefused = null;
  if (strictEnv) {
    const bad = strictEnvCheck(
      entries,
      (e) => resolve(P.workspaceRoot, e.sig),
      current,
      envCfg.ignore
    );
    if (bad.count && enf?.gates.env === 'warn') {
      envRefused = bad;
      console.log(
        `[check] env (warn mode): ${bad.count} baselines were approved in a different environment (${bad.fields.join(', ')}); --strict-env would have refused this run. Rendering anyway.`
      );
    } else if (bad.count) {
      await pool.close();
      die(
        `setup error: ${bad.count} baselines were approved in a different environment (${bad.fields.join(', ')}). Nothing was rendered. Render where the baselines were made (the pinned container), or re-take them there with \`pxsig check --full --update --kind environment\`; without --strict-env this is a warning (pxsig doctor).`
      );
    }
  }
  return { lock, fence, sbIndex, envCfg, pool, current, envRefused };
}
