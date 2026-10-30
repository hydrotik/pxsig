#!/usr/bin/env node
/**
 * ui.mjs — the dashboard's UI contract tooling (packages/dashboard/ui-tools.mjs does the work).
 *
 *   node scripts/ui.mjs docs              regenerate src/ui/manifest.json, docs/ui/features.md and
 *                                         fixtures/screens.json
 *   node scripts/ui.mjs manifest          regenerate src/ui/manifest.json only
 *   node scripts/ui.mjs check             the contract, its docs and the reference adapter agree, and
 *                                         no design-system import sits outside src/ui/adapters/ (CI)
 *   node scripts/ui.mjs gaps [--ui x]     an adapter's gaps against the contract (default: the
 *                                         adapter the build would use: PXSIG_UI_ADAPTER, else hydrotik
 *                                         when PXSIG_DS_SOURCE is set, else plain)
 *   node scripts/ui.mjs lock              record the contract in src/ui/contract-lock.json, after a
 *                                         change, its CONTRACT_VERSION bump and its changes entry;
 *                                         with PXSIG_DS_SOURCE set, `types` too
 *   node scripts/ui.mjs types [--check]   regenerate the reference adapter's design-system
 *                                         declarations (adapters/hydrotik/design-system.d.ts) from
 *                                         the built checkout PXSIG_DS_SOURCE names; --check fails
 *                                         when the committed file differs instead of writing it
 *
 * Exit: 0 ok · 1 problems (a required component missing, a malformed conformance file).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildManifest,
  checkAll,
  compareVersions,
  contractDiff,
  contractShape,
  docsDir,
  featuresMarkdown,
  featuresMdFile,
  gapsOf,
  gapsText,
  lockFile,
  lockFor,
  lockText,
  manifestFile,
  manifestText,
  readChanges,
  readFeatures,
  readLock,
  screensFile,
  screensText,
} from '../packages/dashboard/ui-tools.mjs';
import { resolveAdapter } from '../packages/dashboard/build-config.mjs';
import { generate, typesFile } from './lib/hydrotik-types.mjs';

const [cmd, ...args] = process.argv.slice(2);
const repo = fileURLToPath(new URL('..', import.meta.url));

// docs and check read src/ui/features.ts with Node's type stripping, on by default from 22.18.
const [major, minor] = process.versions.node.split('.').map(Number);
if ((cmd === 'docs' || cmd === 'check') && (major < 22 || (major === 22 && minor < 18))) {
  console.error(
    `[ui] ${cmd} needs Node 22.18 or later (it reads src/ui/features.ts with type stripping); this is Node ${process.versions.node}`
  );
  process.exit(2);
}
/** @param {string} n */
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/**
 * Regenerate (or, with check, compare) the reference adapter's declarations. Returns whether the
 * committed file is current.
 * @param {{ check?: boolean }} [opts]
 */
async function types({ check = false } = {}) {
  const source = process.env.PXSIG_DS_SOURCE;
  if (!source) throw new Error('[ui] types needs PXSIG_DS_SOURCE: a built design-system checkout');
  const scratch = path.join(repo, 'node_modules', '.cache', 'pxsig-ds-types');
  const text = await generate(source, { scratch });
  const current = existsSync(typesFile) && readFileSync(typesFile, 'utf8') === text;
  const rel = path.relative(repo, typesFile).split(path.sep).join('/');
  if (check)
    console[current ? 'log' : 'error'](
      `[ui] ${rel}: ${current ? 'current' : 'stale; run node scripts/ui.mjs types'}`
    );
  else if (!current) {
    writeFileSync(typesFile, text);
    console.log(`[ui] wrote ${rel}`);
  } else console.log(`[ui] ${rel} already current`);
  return current;
}

try {
  if (cmd === 'types') {
    const current = await types({ check: args.includes('--check') });
    process.exit(!current && args.includes('--check') ? 1 : 0);
  } else if (cmd === 'manifest' || cmd === 'docs') {
    writeFileSync(manifestFile, manifestText());
    console.log('[ui] wrote packages/dashboard/src/ui/manifest.json');
    if (cmd === 'docs') {
      mkdirSync(docsDir, { recursive: true });
      const features = await readFeatures();
      writeFileSync(featuresMdFile, featuresMarkdown(features));
      console.log('[ui] wrote docs/ui/features.md');
      writeFileSync(screensFile, screensText(features));
      console.log('[ui] wrote packages/dashboard/fixtures/screens.json');
    }
  } else if (cmd === 'check') {
    const problems = await checkAll();
    if (problems.length) {
      console.error(`[ui] ${problems.length} problem(s):`);
      for (const p of problems) console.error(`  ${p}`);
      process.exit(1);
    }
    console.log(
      '[ui] ok · imports, manifest, feature catalogue, build prompt and reference adapter agree'
    );
  } else if (cmd === 'lock') {
    if (process.env.PXSIG_DS_SOURCE) await types();
    else console.log('[ui] types: skipped (set PXSIG_DS_SOURCE to refresh design-system.d.ts)');
    const now = contractShape();
    const lock = readLock();
    if (lock) {
      const { major: big, minor: small } = contractDiff(lock, now);
      const why = [...big, ...small];
      if (!why.length && lock.version === now.version) {
        console.log(`[ui] contract-lock.json already records contract ${now.version}`);
        process.exit(0);
      }
      /** @type {string[]} */
      const bad = [];
      if (compareVersions(now.version, lock.version) <= 0)
        bad.push(`CONTRACT_VERSION (${now.version}) must be above the locked ${lock.version}`);
      if (big.length && Number(now.version.split('.')[0]) <= Number(lock.version.split('.')[0]))
        bad.push(`${big.join('; ')}: a major change needs a major version`);
      if (!readChanges()[now.version])
        bad.push(`docs/ui/contract-changes.md needs a "## ${now.version}" section`);
      if (bad.length) {
        console.error(`[ui] not locked:\n  ${bad.join('\n  ')}`);
        process.exit(1);
      }
      if (why.length) console.log(`[ui] ${now.version}: ${why.join('; ')}`);
    }
    writeFileSync(lockFile, lockText(lockFor(now, lock)));
    console.log(
      `[ui] wrote packages/dashboard/src/ui/contract-lock.json (contract ${now.version})`
    );
  } else if (cmd === 'gaps') {
    const ui = resolveAdapter({ adapter: flag('ui') });
    const report = gapsOf({ adapterFile: ui.file, manifest: buildManifest() });
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : gapsText(report));
    process.exit(report.problems.length ? 1 : 0);
  } else {
    console.error(
      'usage: node scripts/ui.mjs docs | manifest | check | lock | types [--check] | gaps [--ui <name or path>] [--json]'
    );
    process.exit(2);
  }
} catch (e) {
  // ui-tools and build-config throw Errors; the fs calls Node system errors (Errors too).
  console.error(/** @type {Error} */ (e).message);
  process.exit(1);
}
