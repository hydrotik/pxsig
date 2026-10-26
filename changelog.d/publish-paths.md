### Fixed

- **The release workflow publishes the packed tarballs.** `npm publish` was given
  `release-files/<name>.tgz`, which npm reads as a GitHub repository, so the 0.4.0 run failed
  before publishing anything. The path now starts with `./`, and a dry run always runs `npm publish
  --dry-run` instead of skipping versions already on npm, so it tests that step.
