/**
 * The UI contract as data (ui-tools.mjs): CONTRACT, its version, the shape the lock records, the
 * lock and its changes, and how an adapter's contract version relates to this one.
 */
/** @import { Contract, ContractLock, ContractShape, ContractStatus, LockMark } from '../ui-tools.mjs' */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { dashboardDir, repoRoot, uiDir } from './paths.mjs';

/**
 * contract.ts's text, then its parts in contract/*.ts (by name) when that folder exists: what the
 * readers below parse, so the contract can be split into files without changing what they see.
 * @param {string} file
 */
function contractText(file) {
  const dir = path.join(path.dirname(file), path.basename(file, '.ts'));
  const more = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.ts'))
        .sort()
    : [];
  return [file, ...more.map((f) => path.join(dir, f))]
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

/**
 * CONTRACT from contract.ts: name → { group, required, role }, in declaration order.
 * @param {string} [file]
 * @returns {Contract}
 */
export function readContract(file = path.join(uiDir, 'contract.ts')) {
  const text = contractText(file);
  const start = text.indexOf('export const CONTRACT = {');
  const block = text.slice(start, text.indexOf('} as const satisfies', start));
  /** @type {Contract} */
  const out = {};
  const re =
    /^\s{2}(\w+): \{ group: '(\w+)', required: (true|false), role: (?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)") \},?$/gm;
  for (const m of block.matchAll(re))
    out[m[1]] = {
      group: m[2],
      required: m[3] === 'true',
      role: (m[4] ?? m[5]).replace(/\\(.)/g, '$1'),
    };
  if (!Object.keys(out).length) throw new Error(`[pxsig ui] no CONTRACT table found in ${file}`);
  return out;
}

// --- the contract's version and its lock (docs/ui/contract-changes.md) ----------------------------

export const lockFile = path.join(uiDir, 'contract-lock.json');

/**
 * CONTRACT_VERSION from contract.ts.
 * @param {string} [file]
 */
export function readContractVersion(file = path.join(uiDir, 'contract.ts')) {
  const m = readFileSync(file, 'utf8').match(
    /^export const CONTRACT_VERSION = '(\d+\.\d+\.\d+)';$/m
  );
  if (!m) throw new Error(`[pxsig ui] no CONTRACT_VERSION in ${file}`);
  return m[1];
}

/** @param {string} v */
const parts = (v) =>
  String(v)
    .split('.')
    .map((n) => Number(n) || 0);
/**
 * -1, 0 or 1, as semver orders `a` and `b` (major.minor.patch only).
 * @param {string} a
 * @param {string} b
 */
export function compareVersions(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}
/** @param {string} v */
const major = (v) => parts(v)[0];

/**
 * The names in a `NAME = [ 'a', 'b' ] as const` list.
 * @param {string} text
 * @param {string} name
 * @param {string} [quoteRe]
 */
function listOf(text, name, quoteRe = '[\\w.-]+') {
  const start = text.indexOf(`${name} = [`);
  if (start < 0) return [];
  return [
    ...text
      .slice(start, text.indexOf('] as const', start))
      .matchAll(new RegExp(`^\\s*'(${quoteRe})'`, 'gm')),
  ].map((m) => m[1]);
}
/**
 * The keys of a `NAME = { a: …, 'b-c': … } as const` object (empty for `{}`).
 * @param {string} text
 * @param {string} name
 */
function defaultsOf(text, name) {
  const start = text.indexOf(`${name} = {`);
  if (start < 0) return [];
  const body = text.slice(start + name.length + 4, text.indexOf('} as const', start));
  return [...body.matchAll(/^\s*(?:'([\w.-]+)'|([\w]+)):/gm)].map((m) => m[1] ?? m[2]);
}

/**
 * Each exported interface or type in contract.ts, by name, as normalised text.
 * @param {string} text
 */
function declarations(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of text.matchAll(/^export (?:interface|type) (\w+)[^\n]*$/gm)) {
    const startAt = m.index;
    let end = text.indexOf('\n', startAt);
    if (/\{\s*$/.test(m[0])) end = text.indexOf('\n}', startAt) + 2;
    out[m[1]] = text
      .slice(startAt, end)
      .replace(/\/\*\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return out;
}

/**
 * The contract as data for the lock: each component's required flag and a hash of its props (its
 * props interface and the contract types that interface names), the token names and icon names,
 * and which tokens and icons have a default.
 * @param {{ contractFile?: string, tokensFile?: string }} [files]
 * @returns {ContractShape}
 */
export function contractShape({
  contractFile = path.join(uiDir, 'contract.ts'),
  tokensFile = path.join(uiDir, 'tokens.ts'),
} = {}) {
  const text = contractText(contractFile);
  const tokensText = readFileSync(tokensFile, 'utf8');
  const decl = declarations(text);
  const propsBlock = text.slice(
    text.indexOf('export interface ComponentProps {'),
    text.indexOf('\n}', text.indexOf('export interface ComponentProps {'))
  );
  const propsOf = Object.fromEntries(
    [...propsBlock.matchAll(/^\s{2}(\w+): (\w+)/gm)].map((m) => [m[1], m[2]])
  );
  /** @param {string} iface */
  const hashOf = (iface) => {
    const own = decl[iface] ?? '';
    const used = [...new Set([...own.matchAll(/\b([A-Z]\w+)\b/g)].map((m) => m[1]))]
      .filter((n) => n !== iface && decl[n])
      .sort();
    return createHash('sha256')
      .update([own, ...used.map((n) => decl[n])].join('\n'))
      .digest('hex')
      .slice(0, 16);
  };
  const contract = readContract(contractFile);
  return {
    version: readContractVersion(contractFile),
    components: Object.fromEntries(
      Object.entries(contract).map(([n, c]) => [
        n,
        { required: c.required, hash: hashOf(propsOf[n] ?? `${n}Props`) },
      ])
    ),
    tokens: listOf(tokensText, 'TOKEN_NAMES'),
    tokenDefaults: defaultsOf(tokensText, 'TOKEN_DEFAULTS'),
    icons: listOf(text, 'ICON_NAMES'),
    iconDefaults: defaultsOf(text, 'ICON_DEFAULTS'),
  };
}

/**
 * @param {string} [file]
 * @returns {ContractLock | null}
 */
export function readLock(file = lockFile) {
  // contract-lock.json is written by lockText (`node scripts/ui.mjs lock`).
  return existsSync(file)
    ? /** @type {ContractLock} */ (JSON.parse(readFileSync(file, 'utf8')))
    : null;
}

/**
 * How the contract changed since the lock: `{ major: [...], minor: [...] }`, each a sentence.
 * @param {ContractLock} lock
 * @param {ContractShape} now
 */
export function contractDiff(lock, now) {
  /** @type {string[]} */
  const major = [];
  /** @type {string[]} */
  const minor = [];
  for (const [n, c] of Object.entries(lock.components)) {
    const k = now.components[n];
    if (!k) major.push(`${n} was removed`);
    else {
      if (!c.required && k.required) major.push(`${n} became required`);
      else if (c.required && !k.required) minor.push(`${n} became optional`);
      if (c.hash !== k.hash)
        minor.push(
          `${n}'s props changed (a removed or re-meant prop is a major change: say which in the changes entry)`
        );
    }
  }
  for (const [n, k] of Object.entries(now.components))
    if (!lock.components[n])
      (k.required ? major : minor).push(`${n} was added${k.required ? ' as required' : ''}`);
  for (const [kind, list, defaults] of /** @type {const} */ ([
    ['token', 'tokens', 'tokenDefaults'],
    ['icon', 'icons', 'iconDefaults'],
  ])) {
    for (const n of Object.keys(lock[list]))
      if (!now[list].includes(n)) major.push(`the ${kind} ${n} was removed`);
    for (const n of now[list])
      if (!lock[list][n])
        (now[defaults].includes(n) ? minor : major).push(
          `the ${kind} ${n} was added${now[defaults].includes(n) ? ' with a default' : ' without a default'}`
        );
  }
  return { major, minor };
}

/**
 * The lock for `now`, keeping when each token, icon and component first appeared.
 * @param {ContractShape} now
 * @param {ContractLock | null} [previous]
 * @returns {ContractLock}
 */
export function lockFor(now, previous = null) {
  /** @param {'tokens' | 'icons'} group @param {string} n @returns {LockMark} */
  const since = (group, n) =>
    // A mark is a version string, or an object with `since` (whose `since` is read first).
    /** @type {{ since?: string } | undefined} */ (previous?.[group]?.[n])?.since ??
    previous?.[group]?.[n] ??
    now.version;
  return {
    $comment:
      'GENERATED by `node scripts/ui.mjs lock` after a contract change, its version bump and its docs/ui/contract-changes.md entry. Do not edit.',
    version: now.version,
    components: Object.fromEntries(
      Object.entries(now.components).map(([n, c]) => [
        n,
        {
          required: c.required,
          hash: c.hash,
          since: previous?.components?.[n]?.since ?? now.version,
        },
      ])
    ),
    tokens: Object.fromEntries(now.tokens.map((n) => [n, since('tokens', n)])),
    icons: Object.fromEntries(now.icons.map((n) => [n, since('icons', n)])),
  };
}
/** @param {ContractLock} lock */
export const lockText = (lock) => `${JSON.stringify(lock, null, 2)}\n`;

/**
 * docs/ui/contract-changes.md: version → its section's text. In the repository it is under docs/ui/;
 * in the installed package, beside the dashboard source (sync-dashboard-source.mjs copies it there).
 * @param {string} [file]
 * @returns {Record<string, string>}
 */
export function readChanges(
  file = [
    path.join(repoRoot, 'docs', 'ui', 'contract-changes.md'),
    path.join(dashboardDir, '..', 'docs', 'ui', 'contract-changes.md'),
  ].find(existsSync)
) {
  if (!file || !existsSync(file)) return {};
  const text = readFileSync(file, 'utf8');
  /** @type {Record<string, string>} */
  const out = {};
  const heads = [...text.matchAll(/^## (\d+\.\d+\.\d+)\b.*$/gm)];
  heads.forEach(
    (h, i) =>
      (out[h[1]] = text.slice(h.index + h[0].length, heads[i + 1]?.index ?? text.length).trim())
  );
  return out;
}

/**
 * What `pnpm ui:check` says about the version and the lock: the lock matches the contract and its
 * version; a change since the lock needs a bump of the right size and a changes entry.
 * @param {{ lock: ContractLock | null, now: ContractShape, changes: Record<string, string> }} o
 */
export function lockProblems({ lock, now, changes }) {
  if (!lock) return ['src/ui/contract-lock.json is missing: run node scripts/ui.mjs lock'];
  /** @type {string[]} */
  const problems = [];
  const { major: big, minor: small } = contractDiff(lock, now);
  const changed = big.length || small.length;
  if (!changes[now.version])
    problems.push(
      `docs/ui/contract-changes.md has no "## ${now.version}" section for the contract's version`
    );
  if (changed) {
    const cmp = compareVersions(now.version, lock.version);
    if (cmp <= 0)
      problems.push(
        `the contract changed since contract-lock.json (${[...big, ...small].join('; ')}) but CONTRACT_VERSION is still ${now.version}: bump it (${big.length ? 'major' : 'minor'}), add its entry to docs/ui/contract-changes.md, then run node scripts/ui.mjs lock`
      );
    else if (big.length && major(now.version) <= major(lock.version))
      problems.push(
        `${big.join('; ')}: a major change, but CONTRACT_VERSION went from ${lock.version} to ${now.version}`
      );
    else
      problems.push(
        `the contract changed (${[...big, ...small].join('; ')}): run node scripts/ui.mjs lock to record ${now.version}`
      );
  } else if (lock.version !== now.version)
    problems.push(
      `CONTRACT_VERSION is ${now.version} but contract-lock.json records ${lock.version} and nothing changed: put it back, or change the contract`
    );
  return problems;
}

/**
 * How an adapter's contract version (conformance.json `contract`; absent: 1.0.0) relates to this
 * one: `same`, `older-minor` (it works; newer optional parts fall back), `older-major` (it cannot be
 * built until it is updated: the migration notes say how) or `newer` (written for a later pxsig).
 * @param {string} [adapterVersion]
 * @param {{ lock?: ContractLock | null, changes?: Record<string, string> }} [o]
 * @returns {ContractStatus}
 */
export function contractStatus(
  adapterVersion = '1.0.0',
  { lock = readLock(), changes = readChanges() } = {}
) {
  const current = lock?.version ?? readContractVersion();
  const cmp = compareVersions(adapterVersion, current);
  if (cmp === 0)
    return {
      adapter: adapterVersion,
      current,
      status: 'same',
      line: `written for contract ${current}, the same as this pxsig`,
    };
  if (cmp > 0)
    return {
      adapter: adapterVersion,
      current,
      status: 'newer',
      line: `written for contract ${adapterVersion}; this pxsig has ${current}: parts newer than ${current} are unused`,
    };
  /** @param {'components' | 'tokens' | 'icons'} group */
  const newer = (group) =>
    Object.entries(lock?.[group] ?? {})
      .filter(
        ([, v]) =>
          // A mark is a version string or an object with `since` (LockMark; components have one).
          compareVersions(
            /** @type {string} */ (/** @type {{ since?: string }} */ (v).since ?? v),
            adapterVersion
          ) > 0
      )
      .map(([n]) => n);
  if (major(adapterVersion) < major(current)) {
    const notes = Object.keys(changes)
      .filter(
        (v) =>
          major(v) > major(adapterVersion) &&
          compareVersions(v, current) <= 0 &&
          parts(v)[1] === 0 &&
          parts(v)[2] === 0
      )
      .sort(compareVersions)
      .map((v) => `${v}:\n${changes[v]}`);
    return {
      adapter: adapterVersion,
      current,
      status: 'older-major',
      line: `written for contract ${adapterVersion}; this pxsig has ${current}, a major change: update the adapter (migration notes below), then set "contract": "${current}" in its conformance.json`,
      notes,
    };
  }
  const since = [
    ...newer('components'),
    ...newer('tokens').map((t) => `token ${t}`),
    ...newer('icons').map((i) => `icon ${i}`),
  ];
  return {
    adapter: adapterVersion,
    current,
    status: 'older-minor',
    line: `written for contract ${adapterVersion}; this pxsig has ${current}${since.length ? `: these fall back to their defaults until the adapter maps them: ${since.join(', ')}` : ''}`,
  };
}
