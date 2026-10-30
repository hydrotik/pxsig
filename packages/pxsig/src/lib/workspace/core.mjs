/** The setup error every part of workspace.mjs throws, and the JSON reader that throws it. */
import { readJsonFile as readJsonOrThrow } from '../files.mjs';

/** A problem with the setup (no workspace, a bad config): commands exit 2 with its message. */
export class SetupError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, choices?: string[] }} [extra]
   */
  constructor(message, extra = {}) {
    super(message);
    this.setup = true;
    Object.assign(this, extra);
  }
}

/**
 * A config or workspace file's JSON (a UTF-8 BOM is skipped), or a SetupError: missing, broken,
 * or saved as UTF-16.
 * @param {string} path
 * @returns {unknown}
 */
export function readJsonFile(path) {
  try {
    return readJsonOrThrow(path);
  } catch (e) {
    const { message } = /** @type {Error} */ (e);
    throw new SetupError(
      message.startsWith(path) ? message : `${path} is not valid JSON: ${message}`
    );
  }
}
