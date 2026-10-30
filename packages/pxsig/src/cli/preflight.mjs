/**
 * cli/preflight.mjs — `pxsig doctor` before a manifest exists: the setup preflight
 * (tools/preflight.mjs), the error once, and the next step. Exit 2, as for any setup error.
 */
import { describeAgent } from '../lib/agents.mjs';

/** @import { Block, Cell, Rendered } from '../types/t6.js' */
/** @import { Preflight } from '../tools/preflight.mjs' */

/**
 * @param {string} error the doctor's error ("no readable manifest at …")
 * @param {Preflight} pf
 * @param {string} CMD the name the CLI runs as
 * @returns {Rendered}
 */
export function preflightReport(error, pf, CMD) {
  const { engine, playwright, chromium, storybook, agent } = pf;
  /** @type {(text: string) => Cell} */
  const bad = (text) => ({ text, color: 'red' });
  /** @type {(text: string) => Cell} */
  const gray = (text) => ({ text, color: 'gray' });
  /** @type {[string, Cell][]} */
  const kv = [
    [
      'Engine',
      !engine.present
        ? bad(`not found at ${engine.path}`)
        : `${engine.path} (${engine.version ? `pxsig ${engine.version}` : 'version unknown'})`,
    ],
    [
      'Playwright',
      playwright.path
        ? `${playwright.path} (${playwright.version ?? 'version unknown'})`
        : bad(playwright.error ?? 'not found'),
    ],
    [
      'Chromium',
      chromium.present
        ? `${chromium.path} (present; not launched)`
        : bad(
            chromium.path
              ? `missing at ${chromium.path} (npx playwright install chromium)`
              : (chromium.error ?? 'no path: Playwright did not resolve')
          ),
    ],
    ['Storybook URL', `${storybook.url} (config; not requested)`],
    [
      'Static build',
      storybook.staticDir == null
        ? gray('storybook.staticDir not set')
        : storybook.staticDirPresent
          ? storybook.staticDir
          : bad(`${storybook.staticDir} (missing)`),
    ],
    ['Running under', agent ? describeAgent(agent) : gray('no agent marker')],
  ];
  /** @type {Block[]} */
  const blocks = [
    { h: 'pxsig doctor', sub: 'setup preflight · no manifest yet' },
    { kv },
    { note: error, tone: 'bad' },
    { next: [[`${CMD} manifest`, 'read the stories from Storybook and write the manifest']] },
  ];
  return { blocks, data: { error, preflight: pf, next: `${CMD} manifest` }, exit: 2 };
}
