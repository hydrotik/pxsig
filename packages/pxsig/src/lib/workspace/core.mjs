/** The setup error every part of workspace.mjs throws, and the JSON reader that throws it. */
import { readJsonFile as readJsonOrThrow } from '../files.mjs';
import { shortPath } from '../paths.mjs';

/** A problem with the setup (no workspace, a bad config): commands exit 2 with its message. */
export class SetupError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, choices?: string[] }} [extra]
   */
  constructor(message, extra = {}) {
    super(message);
    /** @readonly */
    this.setup = /** @type {const} */ (true);
    Object.assign(this, extra);
  }
}

/**
 * A config or workspace file's JSON (a UTF-8 BOM is skipped), or a SetupError: missing, broken,
 * or saved as UTF-16. The error names the file relative to the current folder, else by its name:
 * an absolute path names the user.
 * @param {string} path
 * @returns {unknown}
 */
export function readJsonFile(path) {
  try {
    return readJsonOrThrow(path);
  } catch (e) {
    const { message } = /** @type {Error} */ (e);
    const shown = shortPath(process.cwd(), path);
    // Node's ENOENT message, and files.mjs's UTF-16 one, carry the path itself.
    const said = message.split(path).join(shown);
    throw new SetupError(message.startsWith(path) ? said : `${shown} is not valid JSON: ${said}`);
  }
}
