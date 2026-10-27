// Conventional-commit enforcement (the same rules as the hydrotik monorepo).
//
// commitlint runs in the commit-msg hook. The history is already conventional
// ("feat(dashboard): ...", "fix(cli): ..."), so config-conventional is the base.
//
// Required format:
//
//   <type>(<scope>): <subject>
//
// Examples:
//   feat(cli): pxsig --version prints the CLI and engine versions
//   fix(dashboard): a main region and level-one heading on every page
//   release: 0.5.1

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // `release: X.Y.Z` is the release commit (docs/releasing.md); `chore` is everything else.
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'release',
        'revert',
        'style',
        'test',
      ],
    ],
    // Scopes are free-form: a package or area (dashboard, cli, engine, ui, release).
    'scope-empty': [0],
    'header-max-length': [2, 'always', 100],
    // Bodies explain *why*; keep them wrapped so `git log` stays readable in a
    // terminal, but do not fail a commit over a long URL or a pasted command.
    'body-max-line-length': [1, 'always', 100],
  },
};
