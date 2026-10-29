/** The setup error every part of workspace.mjs throws, and the JSON reader that throws it. */
import { readFileSync } from 'node:fs';

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
 * @param {string} path
 * @returns {unknown}
 */
export function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new SetupError(`${path} is not valid JSON: ${/** @type {Error} */ (e).message}`);
  }
}
