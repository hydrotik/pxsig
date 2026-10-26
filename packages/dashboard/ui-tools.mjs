/**
 * ui-tools.mjs — the UI contract as data, without a TypeScript toolchain: the contract's component
 * list, the manifest (which dashboard files render which contract component, read from their
 * `@ui` imports), an adapter's exports and its conformance report, and the gaps between them.
 *
 * Used by `pnpm ui:manifest`, `pnpm ui:gaps`, `pnpm ui:check` (scripts/ui.mjs) and by
 * `pxsig dashboard gaps --ui <path>`. Reads source text with regular expressions: the formats it
 * reads (contract.ts's CONTRACT table, `import { … } from '@ui'`, `export const|function X`) are
 * kept simple on purpose.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const dashboardDir = path.dirname(fileURLToPath(import.meta.url));
export const srcDir = path.join(dashboardDir, 'src');
export const uiDir = path.join(srcDir, 'ui');
export const manifestFile = path.join(uiDir, 'manifest.json');
export const STATUSES = ['full', 'partial', 'bespoke', 'missing'];

/** CONTRACT from contract.ts: name → { group, required, role }, in declaration order. */
export function readContract(file = path.join(uiDir, 'contract.ts')) {
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('export const CONTRACT = {');
  const block = text.slice(start, text.indexOf('} as const satisfies', start));
  const out = {};
  const re = /^\s{2}(\w+): \{ group: '(\w+)', required: (true|false), role: (?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)") \},?$/gm;
  for (const m of block.matchAll(re)) out[m[1]] = { group: m[2], required: m[3] === 'true', role: (m[4] ?? m[5]).replace(/\\(.)/g, '$1') };
  if (!Object.keys(out).length) throw new Error(`[pxsig ui] no CONTRACT table found in ${file}`);
  return out;
}

// --- the contract's version and its lock (docs/ui/contract-changes.md) ----------------------------

export const lockFile = path.join(uiDir, 'contract-lock.json');

/** CONTRACT_VERSION from contract.ts. */
export function readContractVersion(file = path.join(uiDir, 'contract.ts')) {
  const m = readFileSync(file, 'utf8').match(/^export const CONTRACT_VERSION = '(\d+\.\d+\.\d+)';$/m);
  if (!m) throw new Error(`[pxsig ui] no CONTRACT_VERSION in ${file}`);
  return m[1];
}

const parts = (v) => String(v).split('.').map((n) => Number(n) || 0);
/** -1, 0 or 1, as semver orders `a` and `b` (major.minor.patch only). */
export function compareVersions(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}
const major = (v) => parts(v)[0];

/** The names in a `NAME = [ 'a', 'b' ] as const` list. */
function listOf(text, name, quoteRe = "[\\w.-]+") {
  const start = text.indexOf(`${name} = [`);
  if (start < 0) return [];
  return [...text.slice(start, text.indexOf('] as const', start)).matchAll(new RegExp(`^\\s*'(${quoteRe})'`, 'gm'))].map((m) => m[1]);
}
/** The keys of a `NAME = { a: …, 'b-c': … } as const` object (empty for `{}`). */
function defaultsOf(text, name) {
  const start = text.indexOf(`${name} = {`);
  if (start < 0) return [];
  const body = text.slice(start + name.length + 4, text.indexOf('} as const', start));
  return [...body.matchAll(/^\s*(?:'([\w.-]+)'|([\w]+)):/gm)].map((m) => m[1] ?? m[2]);
}

/** Each exported interface or type in contract.ts, by name, as normalised text. */
function declarations(text) {
  const out = {};
  for (const m of text.matchAll(/^export (?:interface|type) (\w+)[^\n]*$/gm)) {
    const startAt = m.index;
    let end = text.indexOf('\n', startAt);
    if (/\{\s*$/.test(m[0])) end = text.indexOf('\n}', startAt) + 2;
    out[m[1]] = text.slice(startAt, end).replace(/\/\*\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  }
  return out;
}

/**
 * The contract as data for the lock: each component's required flag and a hash of its props (its
 * props interface and the contract types that interface names), the token names and icon names,
 * and which tokens and icons have a default.
 */
export function contractShape({ contractFile = path.join(uiDir, 'contract.ts'), tokensFile = path.join(uiDir, 'tokens.ts') } = {}) {
  const text = readFileSync(contractFile, 'utf8');
  const tokensText = readFileSync(tokensFile, 'utf8');
  const decl = declarations(text);
  const propsBlock = text.slice(text.indexOf('export interface ComponentProps {'), text.indexOf('\n}', text.indexOf('export interface ComponentProps {')));
  const propsOf = Object.fromEntries([...propsBlock.matchAll(/^\s{2}(\w+): (\w+)/gm)].map((m) => [m[1], m[2]]));
  const hashOf = (iface) => {
    const own = decl[iface] ?? '';
    const used = [...new Set([...own.matchAll(/\b([A-Z]\w+)\b/g)].map((m) => m[1]))].filter((n) => n !== iface && decl[n]).sort();
    return createHash('sha256').update([own, ...used.map((n) => decl[n])].join('\n')).digest('hex').slice(0, 16);
  };
  const contract = readContract(contractFile);
  return {
    version: readContractVersion(contractFile),
    components: Object.fromEntries(Object.entries(contract).map(([n, c]) => [n, { required: c.required, hash: hashOf(propsOf[n] ?? `${n}Props`) }])),
    tokens: listOf(tokensText, 'TOKEN_NAMES'),
    tokenDefaults: defaultsOf(tokensText, 'TOKEN_DEFAULTS'),
    icons: listOf(text, 'ICON_NAMES'),
    iconDefaults: defaultsOf(text, 'ICON_DEFAULTS'),
  };
}

export function readLock(file = lockFile) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/** How the contract changed since the lock: `{ major: [...], minor: [...] }`, each a sentence. */
export function contractDiff(lock, now) {
  const major = [];
  const minor = [];
  for (const [n, c] of Object.entries(lock.components)) {
    const k = now.components[n];
    if (!k) major.push(`${n} was removed`);
    else {
      if (!c.required && k.required) major.push(`${n} became required`);
      else if (c.required && !k.required) minor.push(`${n} became optional`);
      if (c.hash !== k.hash) minor.push(`${n}'s props changed (a removed or re-meant prop is a major change: say which in the changes entry)`);
    }
  }
  for (const [n, k] of Object.entries(now.components)) if (!lock.components[n]) (k.required ? major : minor).push(`${n} was added${k.required ? ' as required' : ''}`);
  for (const [kind, list, defaults] of [['token', 'tokens', 'tokenDefaults'], ['icon', 'icons', 'iconDefaults']]) {
    for (const n of Object.keys(lock[list])) if (!now[list].includes(n)) major.push(`the ${kind} ${n} was removed`);
    for (const n of now[list]) if (!lock[list][n]) (now[defaults].includes(n) ? minor : major).push(`the ${kind} ${n} was added${now[defaults].includes(n) ? ' with a default' : ' without a default'}`);
  }
  return { major, minor };
}

/** The lock for `now`, keeping when each token, icon and component first appeared. */
export function lockFor(now, previous = null) {
  const since = (group, n) => previous?.[group]?.[n]?.since ?? previous?.[group]?.[n] ?? now.version;
  return {
    $comment: 'GENERATED by `node scripts/ui.mjs lock` after a contract change, its version bump and its docs/ui/contract-changes.md entry. Do not edit.',
    version: now.version,
    components: Object.fromEntries(Object.entries(now.components).map(([n, c]) => [n, { required: c.required, hash: c.hash, since: previous?.components?.[n]?.since ?? now.version }])),
    tokens: Object.fromEntries(now.tokens.map((n) => [n, since('tokens', n)])),
    icons: Object.fromEntries(now.icons.map((n) => [n, since('icons', n)])),
  };
}
export const lockText = (lock) => `${JSON.stringify(lock, null, 2)}\n`;

/**
 * docs/ui/contract-changes.md: version → its section's text. In the repository it is under docs/ui/;
 * in the installed package, beside the dashboard source (sync-dashboard-source.mjs copies it there).
 */
export function readChanges(file = [path.join(repoRoot, 'docs', 'ui', 'contract-changes.md'), path.join(dashboardDir, '..', 'docs', 'ui', 'contract-changes.md')].find(existsSync)) {
  if (!file || !existsSync(file)) return {};
  const text = readFileSync(file, 'utf8');
  const out = {};
  const heads = [...text.matchAll(/^## (\d+\.\d+\.\d+)\b.*$/gm)];
  heads.forEach((h, i) => (out[h[1]] = text.slice(h.index + h[0].length, heads[i + 1]?.index ?? text.length).trim()));
  return out;
}

/**
 * What `pnpm ui:check` says about the version and the lock: the lock matches the contract and its
 * version; a change since the lock needs a bump of the right size and a changes entry.
 */
export function lockProblems({ lock, now, changes }) {
  if (!lock) return ['src/ui/contract-lock.json is missing: run node scripts/ui.mjs lock'];
  const problems = [];
  const { major: big, minor: small } = contractDiff(lock, now);
  const changed = big.length || small.length;
  if (!changes[now.version]) problems.push(`docs/ui/contract-changes.md has no "## ${now.version}" section for the contract's version`);
  if (changed) {
    const cmp = compareVersions(now.version, lock.version);
    if (cmp <= 0) problems.push(`the contract changed since contract-lock.json (${[...big, ...small].join('; ')}) but CONTRACT_VERSION is still ${now.version}: bump it (${big.length ? 'major' : 'minor'}), add its entry to docs/ui/contract-changes.md, then run node scripts/ui.mjs lock`);
    else if (big.length && major(now.version) <= major(lock.version)) problems.push(`${big.join('; ')}: a major change, but CONTRACT_VERSION went from ${lock.version} to ${now.version}`);
    else problems.push(`the contract changed (${[...big, ...small].join('; ')}): run node scripts/ui.mjs lock to record ${now.version}`);
  } else if (lock.version !== now.version) problems.push(`CONTRACT_VERSION is ${now.version} but contract-lock.json records ${lock.version} and nothing changed: put it back, or change the contract`);
  return problems;
}

/**
 * How an adapter's contract version (conformance.json `contract`; absent: 1.0.0) relates to this
 * one: `same`, `older-minor` (it works; newer optional parts fall back), `older-major` (it cannot be
 * built until it is updated: the migration notes say how) or `newer` (written for a later pxsig).
 */
export function contractStatus(adapterVersion = '1.0.0', { lock = readLock(), changes = readChanges() } = {}) {
  const current = lock?.version ?? readContractVersion();
  const cmp = compareVersions(adapterVersion, current);
  if (cmp === 0) return { adapter: adapterVersion, current, status: 'same', line: `written for contract ${current}, the same as this pxsig` };
  if (cmp > 0) return { adapter: adapterVersion, current, status: 'newer', line: `written for contract ${adapterVersion}; this pxsig has ${current}: parts newer than ${current} are unused` };
  const newer = (group) => Object.entries(lock?.[group] ?? {}).filter(([, v]) => compareVersions((v.since ?? v), adapterVersion) > 0).map(([n]) => n);
  if (major(adapterVersion) < major(current)) {
    const notes = Object.keys(changes).filter((v) => major(v) > major(adapterVersion) && compareVersions(v, current) <= 0 && parts(v)[1] === 0 && parts(v)[2] === 0).sort(compareVersions).map((v) => `${v}:\n${changes[v]}`);
    return { adapter: adapterVersion, current, status: 'older-major', line: `written for contract ${adapterVersion}; this pxsig has ${current}, a major change: update the adapter (migration notes below), then set "contract": "${current}" in its conformance.json`, notes };
  }
  const since = [...newer('components'), ...newer('tokens').map((t) => `token ${t}`), ...newer('icons').map((i) => `icon ${i}`)];
  return { adapter: adapterVersion, current, status: 'older-minor', line: `written for contract ${adapterVersion}; this pxsig has ${current}${since.length ? `: these fall back to their defaults until the adapter maps them: ${since.join(', ')}` : ''}` };
}

/** Every source file under a folder (posix-relative paths), skipping `skip` folders. */
export function sourceFiles(dir = srcDir, skip = []) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (!skip.some((s) => rel === s || rel.startsWith(`${s}/`))) walk(p);
      } else if (/\.(tsx?|jsx?|mjs)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

/** The value names a file imports from `@ui` (type-only names excluded). */
export function uiImports(text) {
  const names = new Set();
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@ui['"]/g))
    for (const part of m[1].split(',')) {
      const p = part.trim();
      if (!p || p.startsWith('type ')) continue;
      names.add(p.split(/\s+as\s+/)[0].trim());
    }
  return [...names];
}

/** The manifest: every contract component, its role, and the dashboard files that render it. */
export function buildManifest() {
  const contract = readContract();
  const used = Object.fromEntries(Object.keys(contract).map((n) => [n, []]));
  for (const f of sourceFiles(srcDir, ['ui']))
    for (const n of uiImports(readFileSync(path.join(srcDir, f), 'utf8'))) if (used[n]) used[n].push(f.replace(/\.(tsx?|jsx?)$/, ''));
  // UiRoot renders the adapter's UiProvider; the runtime is the only user.
  used.UiProvider.push('ui/index (UiRoot)');
  return {
    $comment: 'GENERATED by `pnpm ui:manifest` from src/ui/contract.ts and the @ui imports. Do not edit.',
    components: Object.fromEntries(Object.entries(contract).map(([n, c]) => [n, { ...c, usedBy: used[n].sort() }])),
  };
}

export const manifestText = (m = buildManifest()) => `${JSON.stringify(m, null, 2)}\n`;

/** The names a module file exports (`export const|function|class X`, `export { A, B as C }`). */
export function exportsOf(file) {
  const text = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+(\w+)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm))
    for (const part of m[1].split(',')) {
      const p = part.trim().replace(/^type\s+/, '');
      if (p) names.add((p.split(/\s+as\s+/)[1] ?? p).trim());
    }
  return names;
}

/** An adapter's conformance file (conformance.json beside its module), or null. */
export function readConformance(adapterDir) {
  const f = path.join(adapterDir, 'conformance.json');
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, 'utf8'));
}

/**
 * The gaps of one adapter: per contract component, its declared status (conformance.json), whether
 * the module exports it, and the files it affects. A component neither declared nor exported is
 * `missing`; a required one missing is an error (the build fails on it).
 */
export function gapsOf({ adapterFile, manifest = buildManifest() }) {
  const dir = path.dirname(adapterFile);
  const conformance = readConformance(dir);
  const exported = exportsOf(adapterFile);
  const rows = [];
  for (const [name, c] of Object.entries(manifest.components)) {
    const declared = conformance?.components?.[name];
    const has = exported.has(name);
    let status = declared?.status ?? (has ? 'full' : 'missing');
    const notes = [];
    if (declared?.note) notes.push(declared.note);
    if (!has && status !== 'missing') {
      notes.push(`declared ${status} but not exported`);
      status = 'missing';
    }
    if (status === 'missing') notes.push(c.required ? 'the build fails without it' : 'renders the plain fallback (src/ui/fallbacks.tsx)');
    rows.push({ name, group: c.group, required: c.required, status, note: notes.join('; '), usedBy: c.usedBy });
  }
  const problems = [];
  if (!conformance) problems.push(`no conformance.json in ${dir}`);
  else for (const n of Object.keys(conformance.components ?? {})) if (!manifest.components[n]) problems.push(`conformance.json lists "${n}", which is not in the contract`);
  for (const r of rows) if (!STATUSES.includes(r.status)) problems.push(`${r.name}: unknown status "${r.status}"`);
  for (const r of rows) if (r.required && r.status === 'missing') problems.push(`${r.name} is required and missing`);
  for (const t of ['name', 'tokens']) if (!exported.has(t)) problems.push(`the adapter module does not export \`${t}\``);
  const contract = contractStatus(conformance?.contract ?? '1.0.0');
  if (contract.status === 'older-major') problems.push(`contract: ${contract.line}`);
  return { adapter: conformance?.adapter ?? path.basename(dir), contract, rows, problems };
}

/** The gaps report as text: missing, partial and bespoke components, and what each affects. */
export function gapsText({ adapter, contract, rows, problems }) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  const lines = [`UI adapter "${adapter}": ${rows.length} contract components · ${count('full')} full · ${count('bespoke')} bespoke · ${count('partial')} partial · ${count('missing')} missing`];
  if (contract) lines.push(`contract: ${contract.line}`, ...(contract.notes ?? []).map((n) => n.replace(/^/gm, '  ')));
  for (const s of ['missing', 'partial', 'bespoke']) {
    const rs = rows.filter((r) => r.status === s);
    if (!rs.length) continue;
    lines.push('', `${s}:`);
    for (const r of rs) lines.push(`  ${r.name}${r.required ? ' (required)' : ''}${r.note ? ` · ${r.note}` : ''}`, `    used by: ${r.usedBy.join(', ') || 'nothing yet'}`);
  }
  if (problems.length) lines.push('', 'problems:', ...problems.map((p) => `  ${p}`));
  return lines.join('\n');
}

// --- features, docs and the consistency check (pnpm ui:docs, pnpm ui:check) ----------------------

export const repoRoot = path.resolve(dashboardDir, '..', '..');
export const docsDir = path.join(repoRoot, 'docs', 'ui');
export const featuresMdFile = path.join(docsDir, 'features.md');
export const buildPromptFile = path.join(docsDir, 'build-adapter.md');

/** FEATURES from src/ui/features.ts (Node strips its type-only syntax). */
export async function readFeatures() {
  try {
    return (await import(`${pathToFileURL(path.join(uiDir, 'features.ts')).href}?t=${Date.now()}`)).FEATURES;
  } catch (e) {
    throw new Error(`[pxsig ui] cannot read src/ui/features.ts (needs Node 22.18+ for type stripping): ${e.message}`);
  }
}

const SECTION_TITLE = { shell: 'Shell', overview: 'Overview', review: 'Review Stories', coverage: 'Coverage', a11y: 'Accessibility', runs: 'Runs', diagnostics: 'Diagnostics', help: 'Help', inspector: 'Inspector', embed: 'Storybook panel' };

/** docs/ui/features.md: the feature catalogue, generated from FEATURES. */
export function featuresMarkdown(features) {
  const out = [
    '# Dashboard features',
    '',
    '<!-- GENERATED by `pnpm ui:docs` from packages/dashboard/src/ui/features.ts. Do not edit. -->',
    '',
    'Every feature of the pxsig dashboard: what it is for, the states it handles, how it is used, its copy keys',
    '(`src/copy/en.json`) and the UI contract components it renders. An adapter that renders these components',
    'well renders every feature; see [build-adapter.md](build-adapter.md).',
    '',
  ];
  for (const section of Object.keys(SECTION_TITLE)) {
    const fs = features.filter((f) => f.section === section);
    if (!fs.length) continue;
    out.push(`## ${SECTION_TITLE[section]}`, '');
    for (const f of fs) {
      out.push(`### ${f.title}`, '', `\`${f.id}\` · ${f.purpose}`, '');
      const states = Object.entries(f.states);
      if (states.length) out.push('States:', '', ...states.map(([k, v]) => `- **${k}**: ${v}`), '');
      if (f.interactions.length) out.push('Interactions:', '', ...f.interactions.map((i) => `- ${i.action}${i.keys ? ` (${i.keys})` : ''}`), '');
      out.push(`Components: ${f.components.map((c) => `\`${c}\``).join(', ')}`, '', `Copy: ${f.copy.map((c) => `\`${c}\``).join(', ')}`, '', `Files: ${f.files.map((x) => `\`src/${x}\``).join(', ')}`, '');
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

const fileOf = (rel) => ['.tsx', '.ts', '.mjs', '.jsx', '.js'].map((e) => path.join(srcDir, rel + e)).find(existsSync) ?? null;

/** Does a copy key or key prefix exist in en.json? */
function copyExists(messages, key) {
  let node = messages;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return false;
    node = node[part];
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
 */
export async function checkAll() {
  const problems = [];
  const contract = readContract();
  const names = Object.keys(contract);

  // 1. imports
  const ALLOWED = /^(\.{1,2}\/|@ui$|react$|react\/|react-dom$|react-dom\/|@vanilla-extract\/css$)/;
  for (const f of sourceFiles(srcDir, ['ui/adapters'])) {
    const text = readFileSync(path.join(srcDir, f), 'utf8');
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2];
      if (spec === '@ui-adapter' && f === 'ui/index.ts') continue;
      if (!ALLOWED.test(spec)) problems.push(`src/${f}: imports "${spec}"; outside src/ui/adapters/ the dashboard imports only @ui, React, vanilla-extract and its own files`);
    }
  }

  // 2. generated files
  if (!existsSync(manifestFile) || readFileSync(manifestFile, 'utf8') !== manifestText()) problems.push('src/ui/manifest.json is out of date: run pnpm ui:docs');
  const features = await readFeatures();
  if (!existsSync(featuresMdFile) || readFileSync(featuresMdFile, 'utf8') !== featuresMarkdown(features)) problems.push('docs/ui/features.md is out of date: run pnpm ui:docs');

  // 3. contract ↔ build prompt ↔ reference adapter
  const prompt = existsSync(buildPromptFile) ? readFileSync(buildPromptFile, 'utf8') : '';
  if (!prompt) problems.push('docs/ui/build-adapter.md is missing');
  const sections = new Set([...prompt.matchAll(/^### `(\w+)`/gm)].map((m) => m[1]));
  for (const n of names) if (!sections.has(n)) problems.push(`docs/ui/build-adapter.md has no section for ${n} (a heading: ### \`${n}\`)`);
  for (const s of sections) if (!contract[s]) problems.push(`docs/ui/build-adapter.md has a section for ${s}, which is not in the contract`);
  const refDir = path.join(uiDir, 'adapters', 'hydrotik');
  const ref = gapsOf({ adapterFile: path.join(refDir, 'index.tsx') });
  for (const p of ref.problems) problems.push(`reference adapter: ${p}`);
  for (const r of ref.rows) if (!['full', 'bespoke'].includes(r.status)) problems.push(`reference adapter: ${r.name} is ${r.status}; it must be full or bespoke (and listed in conformance.json)`);
  const declared = readConformance(refDir)?.components ?? {};
  for (const n of names) if (!declared[n]) problems.push(`reference adapter: conformance.json has no entry for ${n}`);
  const refText = readFileSync(path.join(refDir, 'index.tsx'), 'utf8');
  const tokenText = readFileSync(path.join(uiDir, 'tokens.ts'), 'utf8');
  const tokenNames = [...tokenText.slice(tokenText.indexOf('TOKEN_NAMES = ['), tokenText.indexOf('] as const')).matchAll(/^\s*'([\w.]+)'/gm)].map((m) => m[1]);
  for (const t of tokenNames) if (!refText.includes(`'${t}':`)) problems.push(`reference adapter: the token map has no value for ${t}`);
  const contractText = readFileSync(path.join(uiDir, 'contract.ts'), 'utf8');
  const icons = [...contractText.slice(contractText.indexOf('ICON_NAMES = ['), contractText.indexOf('] as const', contractText.indexOf('ICON_NAMES = ['))).matchAll(/^\s*'([\w-]+)'/gm)].map((m) => m[1]);
  for (const i of icons) if (!new RegExp(`^\\s*(?:'${i}'|${i.includes('-') ? '(?!)' : i}):`, 'm').test(refText)) problems.push(`reference adapter: no glyph for the icon "${i}"`);

  // 4. features
  const messages = JSON.parse(readFileSync(path.join(srcDir, 'copy', 'en.json'), 'utf8'));
  const ids = new Set();
  const covered = new Set();
  const inFeatures = new Set();
  for (const f of features) {
    const at = `feature ${f.id}`;
    if (ids.has(f.id)) problems.push(`${at}: duplicate id`);
    ids.add(f.id);
    if (!SECTION_TITLE[f.section]) problems.push(`${at}: unknown section "${f.section}"`);
    for (const k of ['title', 'purpose']) if (!f[k]) problems.push(`${at}: no ${k}`);
    for (const c of f.copy) if (!copyExists(messages, c)) problems.push(`${at}: copy key "${c}" is not in src/copy/en.json`);
    const imported = new Set();
    for (const rel of f.files) {
      const file = fileOf(rel);
      if (!file) {
        problems.push(`${at}: no file src/${rel}`);
        continue;
      }
      covered.add(rel);
      for (const n of uiImports(readFileSync(file, 'utf8'))) imported.add(n === 'UiRoot' ? 'UiProvider' : n);
    }
    for (const c of f.components) {
      inFeatures.add(c);
      if (!contract[c]) problems.push(`${at}: "${c}" is not a contract component`);
      else if (!imported.has(c)) problems.push(`${at}: lists ${c}, which none of its files imports from @ui`);
    }
  }
  for (const f of sourceFiles(srcDir, ['ui'])) if (f.startsWith('views/') && !covered.has(f.replace(/\.(tsx?|jsx?)$/, ''))) problems.push(`src/${f} belongs to no feature in src/ui/features.ts`);
  for (const n of names) if (!inFeatures.has(n)) problems.push(`${n} is in the contract but no feature in src/ui/features.ts renders it`);

  // 5. version, lock, changes
  const now = contractShape();
  problems.push(...lockProblems({ lock: readLock(), now, changes: readChanges() }));
  const refContract = readConformance(refDir)?.contract;
  if (refContract !== now.version) problems.push(`reference adapter: conformance.json says "contract": ${JSON.stringify(refContract ?? null)}; it is kept at the current version, ${now.version}`);
  return problems;
}
