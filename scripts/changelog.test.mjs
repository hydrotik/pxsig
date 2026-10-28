// changelog.mjs: what a fragment may hold, how a release merges them, and the CHANGELOG.md guard.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  HEADINGS,
  directEdit,
  merge,
  missingFragment,
  parseFragment,
  release,
  splitChangelog,
} from './changelog.mjs';

test('a fragment is one or more known sections, each a list', () => {
  const { sections, problems } = parseFragment(
    '### Fixed\n\n- **One.** Text\n  that wraps.\n\n### Added\n\n- Two.\n'
  );
  assert.deepEqual(problems, []);
  assert.equal(sections.get('Fixed'), '- **One.** Text\n  that wraps.');
  assert.equal(sections.get('Added'), '- Two.');
});

test('a malformed fragment names each problem', () => {
  /** @param {string} t */
  const p = (t) => parseFragment(t, 'f.md').problems.join('\n');
  assert.match(p('### Improvements\n\n- x\n'), /unknown heading "Improvements"/);
  assert.match(p('- x\n'), /text before the first/);
  assert.match(p('## Unreleased\n### Fixed\n- x\n'), /only "### <Heading>" sections/);
  assert.match(p('### Fixed\n\n'), /"Fixed" has no entries/);
  assert.match(p('### Fixed\n\nprose, not a list\n'), /must be a list/);
  assert.match(p('### Fixed\n- a\n### Fixed\n- b\n'), /appears twice/);
  assert.match(p(''), /empty/);
});

const CHANGELOG =
  '# Changelog\n\nIntro.\n\n## Unreleased\n\n### Security\n\n- Old guard.\n\n## 0.3.2 - 2026-10-24\n\nSummary.\n\n### Added\n\n- Earlier.\n';

test('Unreleased is found between its heading and the next version', () => {
  const { head, unreleased, tail } = splitChangelog(CHANGELOG);
  assert.ok(head.endsWith('## Unreleased\n'));
  assert.equal(unreleased.sections.get('Security'), '- Old guard.');
  assert.ok(tail.startsWith('## 0.3.2'));
});

test('a release merges Unreleased first, then fragments, in heading order', () => {
  const a = parseFragment('### Security\n\n- From a.\n').sections;
  const b = parseFragment('### Behaviour changes\n\n- From b.\n\n### Fixed\n\n- Fix b.\n').sections;
  const out = release(CHANGELOG, [{ sections: a }, { sections: b }], '0.4.0', '2026-11-01');
  const order = [
    '## Unreleased',
    '## 0.4.0 - 2026-11-01',
    '### Behaviour changes',
    '- From b.',
    '### Fixed',
    '### Security',
    '- Old guard.',
    '- From a.',
    '## 0.3.2',
  ];
  let at = -1;
  for (const s of order) {
    const i = out.indexOf(s, at + 1);
    assert.ok(i > at, `"${s}" in order`);
    at = i;
  }
  assert.match(out, /## Unreleased\n\n## 0\.4\.0/, 'Unreleased is left empty');
  assert.throws(
    () => release('# C\n\n## Unreleased\n\n## 0.1.0 - x\n', [], '0.2.0', 'd'),
    /nothing to release/
  );
});

test('merge keeps HEADINGS order and skips empty headings', () => {
  const m = merge([new Map([['Fixed', '- f']]), new Map([['Added', '- a']])]);
  assert.equal(m, '### Added\n\n- a\n\n### Fixed\n\n- f\n');
  assert.equal(HEADINGS[0], 'Behaviour changes');
});

test('only a release/ branch may edit CHANGELOG.md', () => {
  assert.equal(directEdit(['changelog.d/x.md'], 'feat/x'), null);
  assert.equal(directEdit(['CHANGELOG.md'], 'release/0.4.0'), null);
  // A string here (assert.match fails the test on null).
  assert.match(
    /** @type {string} */ (directEdit(['CHANGELOG.md', 'a.mjs'], 'feat/x')),
    /add a fragment in changelog\.d\//
  );
});

test('a branch that changes shipped code adds a fragment, or says "Changelog: none"', () => {
  const code = ['packages/pxsig/src/cli.mjs', 'docs/cli.md'];
  // A string here (assert.match fails the test on null).
  assert.match(
    /** @type {string} */ (missingFragment(code, [], ['fix(cli): x\n\nWhy.\n'], 'fix/x')),
    /packages\/pxsig\/src\/cli\.mjs\) with no fragment in changelog\.d\//
  );
  for (const f of [
    'crates/pxsig-core/src/compare.rs',
    'packages/storybook-addon/manager.mjs',
    'packages/dashboard/src/App.tsx',
  ])
    assert.ok(missingFragment([f], [], [], 'feat/x'), f);
  assert.equal(missingFragment(code, ['changelog.d/cli-fix.md'], [], 'fix/x'), null);
  assert.ok(
    missingFragment(code, ['changelog.d/README.md'], [], 'fix/x'),
    'README is not a fragment'
  );
  assert.equal(missingFragment(code, [], ['refactor: y\n\nChangelog: none\n'], 'fix/x'), null);
  assert.ok(missingFragment(code, [], ['refactor: y\n\nChangelog: none, really\n'], 'fix/x'));
  assert.equal(missingFragment(code, [], [], 'release/0.6.0'), null);
  // Not shipped code: tests, scripts, docs, the addon's tests and config.
  assert.equal(
    missingFragment(
      [
        'packages/pxsig/test/a.test.mjs',
        'scripts/x.mjs',
        'docs/a.md',
        'packages/storybook-addon/test/a.test.mjs',
        'crates/pxsig-cli/Cargo.toml',
      ],
      [],
      [],
      'chore/x'
    ),
    null
  );
});
