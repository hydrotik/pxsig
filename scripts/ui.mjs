#!/usr/bin/env node
/**
 * ui.mjs — the dashboard's UI contract tooling (packages/dashboard/ui-tools.mjs does the work).
 *
 *   node scripts/ui.mjs manifest          regenerate packages/dashboard/src/ui/manifest.json
 *   node scripts/ui.mjs gaps [--ui x]     an adapter's gaps against the contract (default: the
 *                                         adapter the build would use: PXSIG_UI_ADAPTER, else hydrotik)
 *
 * Exit: 0 ok · 1 problems (a required component missing, a malformed conformance file).
 */
import { writeFileSync } from 'node:fs';
import { buildManifest, gapsOf, gapsText, manifestFile, manifestText } from '../packages/dashboard/ui-tools.mjs';
import { resolveAdapter } from '../packages/dashboard/build-config.mjs';

const [cmd, ...args] = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

try {
  if (cmd === 'manifest') {
    writeFileSync(manifestFile, manifestText());
    console.log(`[ui] wrote ${manifestFile.slice(process.cwd().length + 1)}`);
  } else if (cmd === 'gaps') {
    const ui = resolveAdapter({ adapter: flag('ui') });
    const report = gapsOf({ adapterFile: ui.file, manifest: buildManifest() });
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : gapsText(report));
    process.exit(report.problems.length ? 1 : 0);
  } else {
    console.error('usage: node scripts/ui.mjs manifest | gaps [--ui <name or path>] [--json]');
    process.exit(2);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
