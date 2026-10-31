/**
 * Approving a story's waiting entries together (the dashboard's Approve story, POST
 * /__pxsig/approve-story): off unless the project sets `approvals.byStory: true`, so each entry is
 * approved on its own, after a person has looked at it.
 */
/** @import { CheckRow, Config } from '../../types.js' */

/** Why the server refuses an approve-story request while the setting is off. */
export const BY_STORY_OFF =
  "approving a story's entries together is off: approve each entry on its own, or set `approvals.byStory: true` in pxsig.config.json";

/**
 * Whether the project lets the dashboard approve a story's entries in one batch.
 * @param {Pick<Config, 'approvals'> | null | undefined} config
 */
export const byStory = (config) => config?.approvals?.byStory === true;

/**
 * Why one entry of the story is left out of the batch, or null when it is approved with it.
 * @param {string | undefined} state the entry's review state (review.json)
 * @param {CheckRow | undefined} r the entry's row in the last check
 * @returns {string | null}
 */
export const storySkip = (state, r) =>
  state === 'approved'
    ? 'already approved'
    : state === 'rejected'
      ? 'rejected: decide on it alone'
      : !r || r.skipped
        ? 'not checked yet'
        : r.error
          ? `did not render (${String(r.error).split('\n')[0]})`
          : r.pass && !r.new
            ? 'passes: nothing to approve'
            : null;
