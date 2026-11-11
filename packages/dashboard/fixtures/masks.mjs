/// <reference types="node" />
/**
 * masks.mjs — the mask scenarios (scenarios.mjs adds them): rows whose masks the inspector's
 * Masks section, the header and card badges and the Overview's open items show. A relative time
 * marked `data-volatile` since the baseline (added, and over 25% of the capture), a project mask
 * that grew and a workspace mask removed, all on one entry; and a commit badge whose mask is the
 * baseline's (a pass). Areas are shares of the sample images (320×200). Fixed values, neutral names.
 */
// scenarios.mjs imports this file; its helpers are read only when a scenario is built.
import { changed, data, entry, row } from './scenarios.mjs';

const issue = [{ code: 'changed', severity: 'warn', reason: 'gate failed' }];
const TIME = '[data-volatile="relative time"]';

export const MASK_IDS = {
  changed: 'ui-activity-row--default',
  same: 'ui-commit-badge--default',
};

/** The entry whose masks changed: one added (and large), one grown, one removed. */
export const masksChangedRow = () => ({
  masks: [
    { selector: TIME, source: 'attribute', reason: 'relative time', area: 0.3125 },
    { selector: '.build-id', source: 'project', area: 0.025 },
  ],
  masksLarge: [{ selector: TIME, source: 'attribute', area: 0.3125 }],
  masksChanged: { added: [TIME], removed: ['.clock'], grew: ['.build-id'] },
  masksBaseline: [
    { selector: '.build-id', source: 'project', area: 0.0125 },
    { selector: '.clock', source: 'workspace', area: 0.04 },
  ],
});

export const MASK_SCENARIOS = {
  masks() {
    return data({
      rows: [
        row(MASK_IDS.changed, {
          ...changed,
          reasons: [...changed.reasons, 'masks changed: 1 added, 1 removed, 1 grew'],
          ...masksChangedRow(),
        }),
        row(MASK_IDS.same, {
          masks: [
            {
              selector: '[data-volatile="commit"]',
              source: 'attribute',
              reason: 'commit',
              area: 0.08,
            },
          ],
        }),
      ],
      entries: [entry(MASK_IDS.changed, issue), entry(MASK_IDS.same)],
    });
  },
};
