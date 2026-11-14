/**
 * ds-scrub.mjs — leaves no trace of the design-system source in a checkout ds-fetch made. `git fetch
 * <source> …` writes the source into .git/FETCH_HEAD, and a reflog line may carry it; in CI the
 * source is a secret URL that may hold a token, and a cache or an artifact could pick the folder up.
 * After every fetch (one that failed too) these files are removed, and the checkout must have no
 * remote: ds-fetch fetches by URL, never through one.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Remove what can hold the source from the checkout at `dir`; throw if a remote is configured.
 * @param {string} dir
 */
export function scrubSource(dir) {
  const git = join(dir, '.git');
  if (!existsSync(git)) return;
  rmSync(join(git, 'FETCH_HEAD'), { force: true });
  rmSync(join(git, 'logs'), { recursive: true, force: true });
  const remotes = spawnSync('git', ['-C', dir, 'config', '--get-regexp', '^remote\\.'], {
    encoding: 'utf8',
  });
  // Exit 1: no match, as it must be.
  if (remotes.status === 0 && remotes.stdout.trim())
    throw new Error(
      'the design-system checkout has a git remote configured; ds-fetch never adds one'
    );
}
