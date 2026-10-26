#!/usr/bin/env node
/**
 * ui.mjs — the dashboard's UI contract tooling (packages/dashboard/ui-tools.mjs does the work).
 *
 *   node scripts/ui.mjs docs              regenerate src/ui/manifest.json and docs/ui/features.md
 *   node scripts/ui.mjs manifest          regenerate src/ui/manifest.json only
 *   node scripts/ui.mjs check             the contract, its docs and the reference adapter agree, and
 *                                         no design-system import sits outside src/ui/adapters/ (CI)
 *   node scripts/ui.mjs gaps [--ui x]     an adapter's gaps against the contract (default: the
 *                                         adapter the build would use: PXSIG_UI_ADAPTER, else hydrotik)
 *   node scripts/ui.mjs lock              record the contract in src/ui/contract-lock.json, after a
 *                                         change, its CONTRACT_VERSION bump and its changes entry
 *
 * Exit: 0 ok · 1 problems (a required component missing, a malformed conformance file).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildManifest, checkAll, compareVersions, contractDiff, contractShape, docsDir, featuresMarkdown, featuresMdFile, gapsOf, gapsText, lockFile, lockFor, lockText, manifestFile, manifestText, readChanges, readFeatures, readLock } from '../packages/dashboard/ui-tools.mjs';
import { resolveAdapter } from '../packages/dashboard/build-config.mjs';

const [cmd, ...args] = process.argv.slice(2);

// docs and check read src/ui/features.ts with Node's type stripping, on by default from 22.18.
const [major, minor] = process.versions.node.split('.').map(Number);
if ((cmd === 'docs' || cmd === 'check') && (major < 22 || (major === 22 && minor < 18))) {
  console.error(`[ui] ${cmd} needs Node 22.18 or later (it reads src/ui/features.ts with type stripping); this is Node ${process.versions.node}`);
  process.exit(2);
}
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

try {
  if (cmd === 'manifest' || cmd === 'docs') {
    writeFileSync(manifestFile, manifestText());
    console.log('[ui] wrote packages/dashboard/src/ui/manifest.json');
    if (cmd === 'docs') {
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(featuresMdFile, featuresMarkdown(await readFeatures()));
      console.log('[ui] wrote docs/ui/features.md');
    }
  } else if (cmd === 'check') {
    const problems = await checkAll();
    if (problems.length) {
      console.error(`[ui] ${problems.length} problem(s):`);
      for (const p of problems) console.error(`  ${p}`);
      process.exit(1);
    }
    console.log('[ui] ok · imports, manifest, feature catalogue, build prompt and reference adapter agree');
  } else if (cmd === 'lock') {
    const now = contractShape();
    const lock = readLock();
    if (lock) {
      const { major: big, minor: small } = contractDiff(lock, now);
      const why = [...big, ...small];
      if (!why.length && lock.version === now.version) {
        console.log(`[ui] contract-lock.json already records contract ${now.version}`);
        process.exit(0);
      }
      const bad = [];
      if (compareVersions(now.version, lock.version) <= 0) bad.push(`CONTRACT_VERSION (${now.version}) must be above the locked ${lock.version}`);
      if (big.length && Number(now.version.split('.')[0]) <= Number(lock.version.split('.')[0])) bad.push(`${big.join('; ')}: a major change needs a major version`);
      if (!readChanges()[now.version]) bad.push(`docs/ui/contract-changes.md needs a "## ${now.version}" section`);
      if (bad.length) {
        console.error(`[ui] not locked:\n  ${bad.join('\n  ')}`);
        process.exit(1);
      }
      if (why.length) console.log(`[ui] ${now.version}: ${why.join('; ')}`);
    }
    writeFileSync(lockFile, lockText(lockFor(now, lock)));
    console.log(`[ui] wrote packages/dashboard/src/ui/contract-lock.json (contract ${now.version})`);
  } else if (cmd === 'gaps') {
    const ui = resolveAdapter({ adapter: flag('ui') });
    const report = gapsOf({ adapterFile: ui.file, manifest: buildManifest() });
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : gapsText(report));
    process.exit(report.problems.length ? 1 : 0);
  } else {
    console.error('usage: node scripts/ui.mjs docs | manifest | check | lock | gaps [--ui <name or path>] [--json]');
    process.exit(2);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
