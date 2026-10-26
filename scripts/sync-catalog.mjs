#!/usr/bin/env node
/**
 * sync-catalog.mjs — copies hydrotik's component catalog into docs/ui/catalog/:
 *
 *   node scripts/sync-catalog.mjs --from <hydrotik checkout>
 *
 *   <hydrotik>/docs/llm/catalog.json         → docs/ui/catalog/hydrotik.catalog.json
 *   <hydrotik>/docs/llm/catalog.schema.json  → docs/ui/catalog/hydrotik.catalog.schema.json
 *   (where it came from)                     → docs/ui/catalog/hydrotik.catalog.source.json
 *
 * The schema is copied as it is. The catalog is copied with one change: each record's `context`
 * (the path of its context file inside hydrotik) is dropped, because those files do not ship with
 * pxsig and a consuming repository's paths do not belong here (scripts/check-clean.mjs). The
 * commit they came from goes in the sidecar.
 *
 * It refuses, writing nothing, when the checkout is not hydrotik/hydrotik, has uncommitted changes
 * under docs/llm/, sits on a commit no remote branch contains, or the catalog does not pass its
 * schema. It only reads the checkout.
 *
 * Exit codes: 0 copied (or already current); 1 refused; 2 usage.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './json-schema.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
export const CATALOG_DIR = join(repo, 'docs', 'ui', 'catalog');
const FILES = [
  ['docs/llm/catalog.json', 'hydrotik.catalog.json'],
  ['docs/llm/catalog.schema.json', 'hydrotik.catalog.schema.json'],
];
const ORIGIN = /github\.com[:/]hydrotik\/hydrotik(\.git)?$/;

/** The catalog text with each record's `context` path removed, in the generator's own format. */
export function withoutContext(text) {
  const catalog = JSON.parse(text);
  for (const c of catalog.components) delete c.context;
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

/** Copies the catalog from `from` into `to`; returns `{ ok, message }`. */
export function syncCatalog(from, to = CATALOG_DIR) {
  const git = (...args) => execFileSync('git', ['-C', from, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const refuse = (message) => ({ ok: false, message });
  if (!existsSync(from)) return refuse(`${from}: no such directory`);
  let origin;
  let commit;
  try {
    origin = git('remote', 'get-url', 'origin');
    commit = git('rev-parse', 'HEAD');
  } catch {
    return refuse(`${from} is not a git checkout with an origin remote`);
  }
  if (!ORIGIN.test(origin)) return refuse(`${from}: origin is ${origin}, not hydrotik/hydrotik`);
  const dirty = git('status', '--porcelain', '--', 'docs/llm');
  if (dirty) return refuse(`${from} has uncommitted changes under docs/llm:\n${dirty}\ncommit or stash them first`);
  if (!git('branch', '-r', '--contains', commit)) return refuse(`${from}: ${commit.slice(0, 7)} is on no remote branch; push it first, so the copy names a commit others can see`);
  const texts = FILES.map(([src]) => readFileSync(join(from, src), 'utf8'));
  const schema = JSON.parse(texts[1]);
  const errors = validate(schema, JSON.parse(texts[0]));
  if (errors.length) return refuse(`${FILES[0][0]} does not pass its schema:\n${errors.slice(0, 20).join('\n')}`);
  texts[0] = withoutContext(texts[0]);
  const source = {
    repo: 'hydrotik/hydrotik',
    commit,
    files: Object.fromEntries(FILES.map(([src, dest]) => [dest, src])),
  };
  mkdirSync(to, { recursive: true });
  FILES.forEach(([, dest], i) => writeFileSync(join(to, dest), texts[i]));
  writeFileSync(join(to, 'hydrotik.catalog.source.json'), `${JSON.stringify(source, null, 2)}\n`);
  return { ok: true, message: `copied the catalog from hydrotik/hydrotik ${commit.slice(0, 7)} into ${to}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--from');
  const from = i > 0 ? process.argv[i + 1] : undefined;
  if (!from) {
    console.error('usage: node scripts/sync-catalog.mjs --from <hydrotik checkout>');
    process.exit(2);
  }
  const r = syncCatalog(resolve(from));
  (r.ok ? console.log : console.error)(`[sync-catalog] ${r.message}`);
  process.exit(r.ok ? 0 : 1);
}
