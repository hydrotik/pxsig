/**
 * git-ref.mjs — what a check compares with (`--since <ref>`, `--changed a,b`), checked the same way
 * wherever it comes from: the CLI's flags, or a request to the server (POST /__pxsig/check). A ref
 * reaches git only as one argv word, never through a shell; it must also be a commit here, the
 * rule the engine's `affected` applies (`rev-parse --verify <ref>^{commit}`), and it may not start
 * with `-`, so git never reads it as an option. Changed files are workspace-relative paths inside
 * the workspace.
 */
import { isAbsolute, normalize } from 'node:path';
import { spawnSync } from './spawn.mjs';

/** The longest ref or path accepted. */
const LONGEST = 256;
/** The most changed files one request names. */
const MOST_FILES = 2000;
/**
 * Has a control character (or, with `space`, a space too): in no ref, and in no path a check names.
 * @param {string} s
 * @param {boolean} space
 */
const unsafe = (s, space) => {
  for (let i = 0; i < s.length; i++) {
    const n = s.charCodeAt(i);
    if (n < 0x20 || n === 0x7f || (space && n === 0x20)) return true;
  }
  return false;
};

/**
 * Why `ref` cannot be compared with, or null when it is a commit in `dir`'s repository.
 * @param {string} dir the workspace
 * @param {unknown} ref
 * @returns {string | null}
 */
export function refFault(dir, ref) {
  if (typeof ref !== 'string' || !ref) return 'since: a git ref is needed';
  if (ref.length > LONGEST || ref.startsWith('-') || unsafe(ref, true))
    return 'since: not a git ref';
  const ok = spawnSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    encoding: 'utf8',
  });
  return ok.status === 0
    ? null
    : `git: \`${ref}\` is not a commit here (fetch it, or pass another --since)`;
}

/**
 * Why `files` cannot be a check's changed files, or null: a list of workspace-relative paths.
 * @param {unknown} files
 * @returns {string | null}
 */
export function filesFault(files) {
  if (!Array.isArray(files) || !files.length || files.length > MOST_FILES)
    return `changed: a list of 1 to ${MOST_FILES} files is needed`;
  for (const f of files) {
    if (typeof f !== 'string' || !f || f.length > LONGEST || f.startsWith('-') || unsafe(f, false))
      return 'changed: not a file path';
    const n = normalize(f).replace(/\\/g, '/');
    if (isAbsolute(f) || /^[a-z]:/i.test(f) || n === '..' || n.startsWith('../'))
      return 'changed: paths are relative to the workspace, inside it';
  }
  return null;
}
