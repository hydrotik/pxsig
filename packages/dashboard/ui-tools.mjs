/// <reference types="node" />
/**
 * ui-tools.mjs — the UI contract as data, without a TypeScript toolchain: the contract's component
 * list, the manifest (which dashboard files render which contract component, read from their
 * `@ui` imports), an adapter's exports and its conformance report, and the gaps between them.
 *
 * Used by `pnpm ui:manifest`, `pnpm ui:gaps`, `pnpm ui:check` (scripts/ui.mjs) and by
 * `pxsig dashboard gaps --ui <path>`. Reads source text with regular expressions: the formats it
 * reads (contract.ts's CONTRACT table, `import { … } from '@ui'`, `export const|function X`) are
 * kept simple on purpose.
 *
 * @typedef {{ group: string, required: boolean, role: string }} ContractEntry
 * @typedef {Record<string, ContractEntry>} Contract
 * @typedef {{ $comment: string, components: Record<string, ContractEntry & { usedBy: string[] }> }} UiManifest
 * @typedef {{ version: string, components: Record<string, { required: boolean, hash: string }>, tokens: string[], tokenDefaults: string[], icons: string[], iconDefaults: string[] }} ContractShape
 * @typedef {string | { since?: string }} LockMark
 *   when a token or icon first appeared: a version (an object with `since` is read too)
 * @typedef {{ $comment?: string, version: string, components: Record<string, { required: boolean, hash: string, since?: string }>, tokens: Record<string, LockMark>, icons: Record<string, LockMark> }} ContractLock
 * @typedef {{ adapter: string, current: string, status: 'same' | 'newer' | 'older-major' | 'older-minor', line: string, notes?: string[] }} ContractStatus
 * @typedef {{ adapter?: string, contract?: string, components?: Record<string, { status?: string, note?: string }> }} Conformance
 *   an adapter's conformance.json
 * @typedef {{ name: string, group: string, required: boolean, status: string, note: string, usedBy: string[] }} GapRow
 * @typedef {{ adapter: string, contract: ContractStatus, rows: GapRow[], problems: string[] }} Gaps
 * @typedef {{ role?: unknown, text?: unknown, name?: string, exact?: boolean }} ScreenTarget
 * @typedef {{ scenario: string, state?: string, query?: string, hash?: string, actions?: { click?: ScreenTarget, press?: unknown }[], wait: ScreenTarget }} FeatureScreen
 * @typedef {{ id: string, section: string, title: string, purpose: string, states: Record<string, string>, interactions: { action: string, keys?: string }[], copy: string[], components: string[], files: string[], screens: FeatureScreen[], anchors?: { name: string, target: ScreenTarget }[] }} FeatureDef
 *   a FEATURES entry (src/ui/features.ts's `Feature`), as the checks below read it
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  compareVersions,
  contractDiff,
  contractShape,
  contractStatus,
  lockFile,
  lockFor,
  lockProblems,
  lockText,
  readChanges,
  readContract,
  readContractVersion,
  readLock,
} from './ui-tools/contract.mjs';
import {
  featuresMarkdown,
  readFeatures,
  screenProblems,
  screensFile,
  screensText,
  SECTION_TITLE,
} from './ui-tools/features.mjs';
import {
  buildManifest,
  exportsOf,
  gapsOf,
  gapsText,
  manifestText,
  readConformance,
  sourceFiles,
  STATUSES,
  uiImports,
} from './ui-tools/gaps.mjs';
import {
  buildPromptFile,
  dashboardDir,
  docsDir,
  featuresMdFile,
  manifestFile,
  repoRoot,
  srcDir,
  uiDir,
} from './ui-tools/paths.mjs';

export {
  compareVersions,
  contractDiff,
  contractShape,
  contractStatus,
  lockFile,
  lockFor,
  lockProblems,
  lockText,
  readChanges,
  readContract,
  readContractVersion,
  readLock,
};
export { featuresMarkdown, readFeatures, screenProblems, screensFile, screensText };
export {
  buildManifest,
  exportsOf,
  gapsOf,
  gapsText,
  manifestText,
  readConformance,
  sourceFiles,
  STATUSES,
  uiImports,
};
export {
  buildPromptFile,
  dashboardDir,
  docsDir,
  featuresMdFile,
  manifestFile,
  repoRoot,
  srcDir,
  uiDir,
};

// --- features, docs and the consistency check (pnpm ui:docs, pnpm ui:check) ----------------------

/** @param {string} rel */
const fileOf = (rel) =>
  ['.tsx', '.ts', '.mjs', '.jsx', '.js'].map((e) => path.join(srcDir, rel + e)).find(existsSync) ??
  null;

/**
 * Does a copy key or key prefix exist in en.json?
 * @param {unknown} messages
 * @param {string} key
 */
function copyExists(messages, key) {
  let node = messages;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return false;
    // An object holding `part` (checked on the line before).
    node = /** @type {Record<string, unknown>} */ (node)[part];
  }
  return true;
}

/**
 * Every rule `pnpm ui:check` enforces. Returns a list of problems (empty: all good).
 *  1. No design-system import outside src/ui/adapters/: dashboard files import only relative
 *     paths, `@ui`, React and vanilla-extract.
 *  2. The generated manifest and feature catalogue match the code.
 *  3. Every contract component has a section in docs/ui/build-adapter.md, and the reference
 *     adapter declares it (full or bespoke) and exports it; it maps every token and icon.
 *  4. Every feature names real components, files and copy keys; each component it lists is imported
 *     by one of its files; every view and every contract component belongs to a feature.
 *  5. CONTRACT_VERSION, src/ui/contract-lock.json and docs/ui/contract-changes.md agree: a contract
 *     change needs a version bump of the right size and a changes entry (lockProblems); the
 *     reference adapter is written for the current version.
 *  6. Every feature has a screen for `pxsig dashboard check`, on a known scenario and one of its
 *     own states; fixtures/screens.json matches.
 */
export async function checkAll() {
  /** @type {string[]} */
  const problems = [];
  const contract = readContract();
  const names = Object.keys(contract);

  // 1. imports
  const ALLOWED = /^(\.{1,2}\/|@ui$|react$|react\/|react-dom$|react-dom\/|@vanilla-extract\/css$)/;
  for (const f of sourceFiles(srcDir, ['ui/adapters'])) {
    const text = readFileSync(path.join(srcDir, f), 'utf8');
    for (const m of text.matchAll(
      /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
    )) {
      const spec = m[1] ?? m[2];
      if (spec === '@ui-adapter' && f === 'ui/index.ts') continue;
      if (!ALLOWED.test(spec))
        problems.push(
          `src/${f}: imports "${spec}"; outside src/ui/adapters/ the dashboard imports only @ui, React, vanilla-extract and its own files`
        );
    }
  }

  // 2. generated files
  if (!existsSync(manifestFile) || readFileSync(manifestFile, 'utf8') !== manifestText())
    problems.push('src/ui/manifest.json is out of date: run pnpm ui:docs');
  const features = await readFeatures();
  if (
    !existsSync(featuresMdFile) ||
    readFileSync(featuresMdFile, 'utf8') !== featuresMarkdown(features)
  )
    problems.push('docs/ui/features.md is out of date: run pnpm ui:docs');
  if (!existsSync(screensFile) || readFileSync(screensFile, 'utf8') !== screensText(features))
    problems.push('fixtures/screens.json is out of date: run pnpm ui:docs');

  // 3. contract ↔ build prompt ↔ reference adapter
  const prompt = existsSync(buildPromptFile) ? readFileSync(buildPromptFile, 'utf8') : '';
  if (!prompt) problems.push('docs/ui/build-adapter.md is missing');
  const sections = new Set([...prompt.matchAll(/^### `(\w+)`/gm)].map((m) => m[1]));
  for (const n of names)
    if (!sections.has(n))
      problems.push(`docs/ui/build-adapter.md has no section for ${n} (a heading: ### \`${n}\`)`);
  for (const s of sections)
    if (!contract[s])
      problems.push(
        `docs/ui/build-adapter.md has a section for ${s}, which is not in the contract`
      );
  const refDir = path.join(uiDir, 'adapters', 'hydrotik');
  const ref = gapsOf({ adapterFile: path.join(refDir, 'index.tsx') });
  for (const p of ref.problems) problems.push(`reference adapter: ${p}`);
  for (const r of ref.rows)
    if (!['full', 'bespoke'].includes(r.status))
      problems.push(
        `reference adapter: ${r.name} is ${r.status}; it must be full or bespoke (and listed in conformance.json)`
      );
  const declared = readConformance(refDir)?.components ?? {};
  for (const n of names)
    if (!declared[n]) problems.push(`reference adapter: conformance.json has no entry for ${n}`);
  const refText = readFileSync(path.join(refDir, 'index.tsx'), 'utf8');
  const tokenText = readFileSync(path.join(uiDir, 'tokens.ts'), 'utf8');
  const tokenNames = [
    ...tokenText
      .slice(tokenText.indexOf('TOKEN_NAMES = ['), tokenText.indexOf('] as const'))
      .matchAll(/^\s*'([\w.]+)'/gm),
  ].map((m) => m[1]);
  for (const t of tokenNames)
    if (!refText.includes(`'${t}':`))
      problems.push(`reference adapter: the token map has no value for ${t}`);
  const contractText = readFileSync(path.join(uiDir, 'contract.ts'), 'utf8');
  const icons = [
    ...contractText
      .slice(
        contractText.indexOf('ICON_NAMES = ['),
        contractText.indexOf('] as const', contractText.indexOf('ICON_NAMES = ['))
      )
      .matchAll(/^\s*'([\w-]+)'/gm),
  ].map((m) => m[1]);
  for (const i of icons)
    if (!new RegExp(`^\\s*(?:'${i}'|${i.includes('-') ? '(?!)' : i}):`, 'm').test(refText))
      problems.push(`reference adapter: no glyph for the icon "${i}"`);

  // 4. features
  /** @type {unknown} */
  const messages = JSON.parse(readFileSync(path.join(srcDir, 'copy', 'en.json'), 'utf8'));
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Set<string>} */
  const covered = new Set();
  /** @type {Set<string>} */
  const inFeatures = new Set();
  for (const f of features) {
    const at = `feature ${f.id}`;
    if (ids.has(f.id)) problems.push(`${at}: duplicate id`);
    ids.add(f.id);
    if (!(/** @type {Partial<Record<string, string>>} */ (SECTION_TITLE)[f.section]))
      problems.push(`${at}: unknown section "${f.section}"`);
    for (const k of /** @type {const} */ (['title', 'purpose']))
      if (!f[k]) problems.push(`${at}: no ${k}`);
    for (const c of f.copy)
      if (!copyExists(messages, c))
        problems.push(`${at}: copy key "${c}" is not in src/copy/en.json`);
    /** @type {Set<string>} */
    const imported = new Set();
    for (const rel of f.files) {
      const file = fileOf(rel);
      if (!file) {
        problems.push(`${at}: no file src/${rel}`);
        continue;
      }
      covered.add(rel);
      for (const n of uiImports(readFileSync(file, 'utf8')))
        imported.add(n === 'UiRoot' ? 'UiProvider' : n);
    }
    for (const c of f.components) {
      inFeatures.add(c);
      if (!contract[c]) problems.push(`${at}: "${c}" is not a contract component`);
      else if (!imported.has(c))
        problems.push(`${at}: lists ${c}, which none of its files imports from @ui`);
    }
  }
  for (const f of sourceFiles(srcDir, ['ui']))
    if (f.startsWith('views/') && !covered.has(f.replace(/\.(tsx?|jsx?)$/, '')))
      problems.push(`src/${f} belongs to no feature in src/ui/features.ts`);
  for (const n of names)
    if (!inFeatures.has(n))
      problems.push(`${n} is in the contract but no feature in src/ui/features.ts renders it`);

  // 6. screens
  for (const f of features) problems.push(...screenProblems(f));

  // 5. version, lock, changes
  const now = contractShape();
  problems.push(...lockProblems({ lock: readLock(), now, changes: readChanges() }));
  const refContract = readConformance(refDir)?.contract;
  if (refContract !== now.version)
    problems.push(
      `reference adapter: conformance.json says "contract": ${JSON.stringify(refContract ?? null)}; it is kept at the current version, ${now.version}`
    );
  return problems;
}
