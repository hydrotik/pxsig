#!/usr/bin/env node
/**
 * changelog.mjs — CHANGELOG.md from fragments, so pull requests never edit the same file.
 *
 *   node scripts/changelog.mjs check [--since <ref>]   # every fragment is well formed; with --since,
 *                                                     # also: the branch does not edit CHANGELOG.md
 *                                                     # (only a release/ branch may)
 *   node scripts/changelog.mjs preview                 # the Unreleased section the next release gets
 *   node scripts/changelog.mjs release <x.y.z> [--date YYYY-MM-DD]
 *                                                     # merge Unreleased and every fragment into a
 *                                                     # new version section; delete the fragments
 *
 * A fragment is `changelog.d/<topic>.md`: one or more `### <Heading>` sections (HEADINGS), each a
 * Markdown list, in the style of CHANGELOG.md. A release keeps the headings in HEADINGS order; within
 * one, the entries already under Unreleased come first, then the fragments by file name.
 * Exit: 0 ok · 1 a problem (each one printed) · 2 usage.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const DIR = 'changelog.d';
/** The section headings a fragment may use, in the order a release prints them. */
export const HEADINGS = ['Behaviour changes', 'Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security', 'Documentation', 'Not yet'];
const NAME = /^[a-z0-9][a-z0-9.-]*\.md$/;

/** `{ sections: Map<heading, text>, problems: string[] }` for one fragment's text. */
export function parseFragment(text, label = 'fragment') {
  const sections = new Map();
  const problems = [];
  let heading = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const h = /^###\s+(.+?)\s*$/.exec(line);
    if (h) {
      heading = h[1];
      if (!HEADINGS.includes(heading)) problems.push(`${label}:${i + 1}: unknown heading "${heading}" (use one of: ${HEADINGS.join(', ')})`);
      else if (sections.has(heading)) problems.push(`${label}:${i + 1}: "${heading}" appears twice`);
      sections.set(heading, '');
      return;
    }
    if (/^#{1,2}\s/.test(line) || /^#{4,}\s/.test(line)) return problems.push(`${label}:${i + 1}: only "### <Heading>" sections belong in a fragment`);
    if (!line.trim()) {
      if (heading) sections.set(heading, `${sections.get(heading)}\n`);
      return;
    }
    if (!heading) return problems.push(`${label}:${i + 1}: text before the first "### <Heading>"`);
    sections.set(heading, `${sections.get(heading)}${line}\n`);
  });
  for (const [h, body] of sections) {
    sections.set(h, body.trim());
    if (!body.trim()) problems.push(`${label}: "${h}" has no entries`);
    else if (!/^[-*] /.test(body.trim())) problems.push(`${label}: "${h}" must be a list ("- …")`);
  }
  if (!sections.size && !problems.length) problems.push(`${label}: empty (add at least one "### <Heading>" section)`);
  return { sections, problems };
}

/** Where the Unreleased section starts and ends in CHANGELOG.md, and its sections. */
export function splitChangelog(text) {
  const start = text.indexOf('\n## Unreleased');
  if (start < 0) throw new Error('CHANGELOG.md has no "## Unreleased" section');
  const bodyStart = text.indexOf('\n', start + 1) + 1;
  const next = text.indexOf('\n## ', bodyStart - 1);
  const end = next < 0 ? text.length : next + 1;
  return { head: text.slice(0, bodyStart), unreleased: parseFragment(text.slice(bodyStart, end), 'CHANGELOG.md Unreleased'), tail: text.slice(end) };
}

/** An empty Unreleased is fine; anything else follows the fragment rules. */
const unreleasedProblems = (u) => u.problems.filter((p) => !/: empty \(/.test(p));

/** Sections of Unreleased and the fragments, merged in HEADINGS order, as Markdown. */
export function merge(parts) {
  const out = [];
  for (const h of HEADINGS) {
    const bodies = parts.map((p) => p.get(h)).filter(Boolean);
    if (bodies.length) out.push(`### ${h}\n\n${bodies.join('\n')}\n`);
  }
  return out.join('\n');
}

/** CHANGELOG.md after a release: an empty Unreleased, then the new version's section. */
export function release(changelog, fragments, version, date) {
  const { head, unreleased, tail } = splitChangelog(changelog);
  const bad = unreleasedProblems(unreleased);
  if (bad.length) throw new Error(bad.join('\n'));
  const body = merge([unreleased.sections, ...fragments.map((f) => f.sections)]);
  if (!body) throw new Error('nothing to release: Unreleased and changelog.d/ are both empty');
  return `${head}\n## ${version} - ${date}\n\n${body}\n${tail}`;
}

function fragmentFiles(dir = join(root, DIR)) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n !== 'README.md' && !n.startsWith('.'))
    .sort();
}

function readFragments() {
  const problems = [];
  const fragments = [];
  for (const n of fragmentFiles()) {
    const label = `${DIR}/${n}`;
    if (!NAME.test(n)) {
      problems.push(`${label}: name it <topic>.md (lower case, digits, dots and dashes)`);
      continue;
    }
    const f = parseFragment(readFileSync(join(root, DIR, n), 'utf8'), label);
    problems.push(...f.problems);
    fragments.push({ name: n, sections: f.sections });
  }
  return { fragments, problems };
}

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();

/** Why this branch may not carry its CHANGELOG.md edit, or null. */
export function directEdit(changed, branch) {
  if (!changed.includes('CHANGELOG.md')) return null;
  if (/^release\//.test(branch)) return null;
  return `CHANGELOG.md is edited on "${branch}": add a fragment in ${DIR}/ instead (only a release/ branch changes CHANGELOG.md, with \`node scripts/changelog.mjs release <version>\`)`;
}

function changedSince(ref) {
  let base = ref;
  try {
    base = git('merge-base', ref, 'HEAD');
  } catch {
    // a shallow clone (CI): compare with the ref itself, which on a pull request is the base branch
  }
  return git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
}

function flag(args, k) {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
}

function fail(problems) {
  console.error(`[changelog] ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

function run(args) {
  const [command] = args;
  const path = join(root, 'CHANGELOG.md');
  if (command === 'check') {
    const { fragments, problems } = readFragments();
    try {
      problems.push(...unreleasedProblems(splitChangelog(readFileSync(path, 'utf8')).unreleased));
    } catch (e) {
      problems.push(e.message);
    }
    const since = flag(args, '--since');
    if (since) {
      const branch = process.env.GITHUB_HEAD_REF || git('rev-parse', '--abbrev-ref', 'HEAD');
      const why = directEdit(changedSince(since), branch);
      if (why) problems.push(why);
    }
    if (problems.length) fail(problems);
    return console.log(`[changelog] ok · ${fragments.length} fragment(s)`);
  }
  if (command === 'preview') {
    const { fragments, problems } = readFragments();
    if (problems.length) fail(problems);
    const { unreleased } = splitChangelog(readFileSync(path, 'utf8'));
    return process.stdout.write(`## Unreleased\n\n${merge([unreleased.sections, ...fragments.map((f) => f.sections)]) || '(nothing yet)\n'}`);
  }
  if (command === 'release') {
    const version = args[1];
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
      console.error('usage: node scripts/changelog.mjs release <x.y.z> [--date YYYY-MM-DD]');
      process.exit(2);
    }
    const date = flag(args, '--date') ?? new Date().toISOString().slice(0, 10);
    const { fragments, problems } = readFragments();
    if (problems.length) fail(problems);
    let next;
    try {
      next = release(readFileSync(path, 'utf8'), fragments, version, date);
    } catch (e) {
      fail(e.message.split('\n'));
    }
    writeFileSync(path, next);
    for (const f of fragments) unlinkSync(join(root, DIR, f.name));
    return console.log(`[changelog] ${version}: ${fragments.length} fragment(s) merged into CHANGELOG.md; add the release's summary paragraph under its heading`);
  }
  console.error('usage: node scripts/changelog.mjs check [--since <ref>] | preview | release <x.y.z> [--date YYYY-MM-DD]');
  process.exit(2);
}

// Imported (by its test) for the pure functions: run nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run(process.argv.slice(2));
