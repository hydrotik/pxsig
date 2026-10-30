// required-checks.mjs: the one list matches ci.yml, and a tag's commit needs every one passed.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { REQUIRED, checkRuns, missingChecks } from './required-checks.mjs';

/**
 * The check names GitHub shows for ci.yml: each job's `name:`, with `${{ matrix.os }}` once per OS
 * of its matrix. Read line by line: the file's own layout (two-space jobs, `os: [a, b]`).
 * @param {string} text
 */
function ciCheckNames(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf('jobs:');
  /** @type {{ name: string, os: string[] }[]} */
  const jobs = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}[\w-]+:\s*$/.test(line)) jobs.push({ name: '', os: [] });
    const job = jobs.at(-1);
    if (!job) continue;
    const name = /^ {4}name:\s*(.+?)\s*$/.exec(line);
    if (name) job.name = name[1];
    const os = /^ {8}os:\s*\[(.*)\]\s*$/.exec(line);
    if (os) job.os = os[1].split(',').map((s) => s.trim());
  }
  return jobs.flatMap((j) =>
    j.os.length ? j.os.map((os) => j.name.replace('${{ matrix.os }}', os)) : [j.name]
  );
}

test('REQUIRED is every job and matrix leg of ci.yml, by the name GitHub shows', () => {
  const names = ciCheckNames(
    readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  );
  assert.equal(names.length, 11);
  assert.deepEqual([...REQUIRED].sort(), [...names].sort());
  assert.ok(REQUIRED.includes('Examples (end to end) (windows-latest)'));
});

/**
 * @param {string} name
 * @param {string | null} conclusion
 * @param {string} [started]
 * @param {string} [status]
 */
const run = (name, conclusion, started = '2026-10-28T10:00:00Z', status = 'completed') => ({
  name,
  conclusion,
  started_at: started,
  status,
});

test('every required check passed: nothing to report', () => {
  const pages = [
    { check_runs: REQUIRED.slice(0, 5).map((n) => run(n, 'success')) },
    {
      check_runs: [
        ...REQUIRED.slice(5).map((n) => run(n, 'success')),
        run('Build linux-x64', 'failure'),
      ],
    },
  ];
  assert.deepEqual(missingChecks(checkRuns(pages)), []);
});

test('a missing, failed or running check is named; the latest re-run counts', () => {
  const runs = REQUIRED.filter((n) => !/^(Rust|Clean)/.test(n)).map((n) => run(n, 'success'));
  runs.push(run('Clean repository', 'failure'));
  runs.push(run('Rust (ubuntu-latest)', 'failure', '2026-10-28T09:00:00Z'));
  runs.push(run('Rust (ubuntu-latest)', 'success', '2026-10-28T11:00:00Z'));
  runs.push(run('Rust (macos-latest)', null, '2026-10-28T11:00:00Z', 'in_progress'));
  runs.push(run('Node (windows-latest)', 'failure', '2026-10-28T12:00:00Z'));
  assert.deepEqual(missingChecks(checkRuns({ check_runs: runs })), [
    'Clean repository: failure',
    'Rust (macos-latest): in_progress',
    'Rust (windows-latest): no run on this commit',
    'Node (windows-latest): failure',
  ]);
});

test('anything but check-run pages reads as no runs', () => {
  assert.deepEqual(checkRuns(null), []);
  assert.deepEqual(checkRuns({ message: 'Not Found' }), []);
  assert.equal(missingChecks([]).length, 11);
});
