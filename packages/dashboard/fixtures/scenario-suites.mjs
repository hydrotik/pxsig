/// <reference types="node" />
/**
 * scenario-suites.mjs — the scenario suite scenario (scenarios.mjs adds it): the `clean` data with
 * one suite of `tools/scenarios.mjs` results (`data.scenarioSuites`, reports/scenarios-<suite>.json),
 * so Diagnostics opens on its Scenarios part: the detection rate, the scenario list, the chosen
 * scenario's card (its change as the mono description) and its changed renders. One regression
 * caught in full, one noise scenario with no false positive. Fixed values, neutral names.
 */
// scenarios.mjs imports this file; its exports are read only when a scenario is built.
import { AT, SCENARIOS } from './scenarios.mjs';

const IDS = ['ui-button--primary', 'ui-button--secondary', 'ui-button--ghost'];
const failed = {
  pass: false,
  metrics: { ssim: 0.86, changedCells: 9, changedCellsPct: 2.2, grid: 64 },
  reasons: ['9 cells over 24'],
  wholeImagePass: false,
};
const passed = {
  pass: true,
  metrics: { ssim: 1, changedCells: 0, changedCellsPct: 0, grid: 64 },
  reasons: [],
  wholeImagePass: true,
};
/** @param {string} id @param {boolean} changed @param {typeof failed | typeof passed} gate */
const scenarioRow = (id, changed, gate) => ({
  id,
  error: null,
  changed,
  renderMs: 120,
  detail: null,
  ...gate,
});

/** A scenarios report as tools/scenarios.mjs writes it, for the `buttons` suite. */
const suite = () => ({
  generatedAt: AT,
  project: 'demo',
  gate: { threshold: 24, minCells: 3, grid: 64, minCellPx: 4, detail: true },
  suite: { name: 'buttons', title: 'Buttons', pattern: 'ui-button--' },
  sample: { every: 1, stories: IDS.length, concurrency: 4 },
  renders: 'renders/scenarios-buttons',
  scenarios: [
    {
      name: 'radius',
      kind: 'regression',
      title: 'Button radius changed',
      change: 'Button radius 4px to 6px',
      summary: {
        stories: 3,
        errors: 0,
        changed: 2,
        failed: 2,
        detected: 2,
        detectedWholeImage: 2,
        falsePositives: null,
        renderWallMs: 900,
        rustEngineMs: 14,
      },
      rows: [
        scenarioRow(IDS[0], true, failed),
        scenarioRow(IDS[1], true, failed),
        scenarioRow(IDS[2], false, passed),
      ],
    },
    {
      name: 'opacity',
      kind: 'noise',
      title: 'Imperceptible opacity',
      change: 'Story root opacity 1 to 0.99',
      summary: {
        stories: 3,
        errors: 0,
        changed: 3,
        failed: 0,
        detected: 0,
        detectedWholeImage: 0,
        falsePositives: 0,
        renderWallMs: 850,
        rustEngineMs: 12,
      },
      rows: IDS.map((id) => scenarioRow(id, true, passed)),
    },
  ],
});

export const SCENARIO_SUITE_SCENARIOS = {
  'scenario-suite'() {
    return { ...SCENARIOS.clean(), scenarioSuites: { buttons: suite() } };
  },
};
