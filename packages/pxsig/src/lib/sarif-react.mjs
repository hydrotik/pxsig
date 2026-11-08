/**
 * sarif-react.mjs — React alerts as SARIF 2.1.0 (`check --react-sarif <file>`, `pxsig react --sarif
 * <file>`), a file of its own: the a11y `--sarif` file (sarif.mjs) stays as it is, so no existing
 * code-scanning setup receives anything new. Additive output only: nothing reads it back, and it
 * changes no exit code.
 *
 * - A compiler alert is a result at its file and line, rule `react-compiler/<rule>` (the
 *   eslint-plugin-react-hooks rule; its React docs page as the help link), level `warning` when
 *   the reason made the compiler skip the function, `note` for a finding. Never `error`.
 * - The compiler the alerts came from is the run's tool extension: babel-plugin-react-compiler or
 *   oxc_react_compiler (built in), with its version.
 * - An entry React was still committing in at capture is a `note` at its story file, rule
 *   `react-renders/still-rendering`, with the entry id as the logical location.
 */
import { writeAtomic } from './files.mjs';
import { OXC } from './react/backend.mjs';
import { COMPILER } from './react/peers.mjs';
/** @import { CheckRow, ManifestEntry } from '../types.js' */
/** @import { ReactAlert, ReactReport, ReactSarifLog, ReactSarifResult, ReactSarifRule } from '../types/react.js' */

const STILL = 'react-renders/still-rendering';
/** @param {string} rule */
const helpUri = (rule) =>
  `https://react.dev/reference/eslint-plugin-react-hooks/lints/${encodeURIComponent(rule)}`;

/**
 * @typedef {{ alerts?: ReactAlert[], backend?: Pick<ReactReport['backend'], 'name' | 'compiler'> | null, rows?: CheckRow[], entries?: Map<string, Pick<ManifestEntry, 'importPath'>>, version?: string | null }} ReactSarifInput
 *   `alerts` and `backend`: react.json's; `rows`: check.json rows (their `renders`); `entries`:
 *   manifest stories by id.
 */

/**
 * @param {ReactSarifInput} input
 * @returns {ReactSarifLog}
 */
export function reactSarifLog({
  alerts = [],
  backend = null,
  rows = [],
  entries = new Map(),
  version = null,
}) {
  /** @type {Map<string, ReactSarifRule>} */
  const rules = new Map();
  /** @type {ReactSarifResult[]} */
  const results = [];
  for (const a of alerts) {
    // A diagnostic with no rule is named by its change (`new-function-bailout`, …).
    const name = a.rule || a.change;
    const id = `react-compiler/${name}`;
    if (!rules.has(id))
      rules.set(id, {
        id,
        shortDescription: { text: `React Compiler: ${name}` },
        ...(a.rule ? { helpUri: helpUri(a.rule) } : {}),
        properties: { tags: ['react', 'react-compiler'] },
      });
    results.push({
      ruleId: id,
      level: a.level === 'warning' ? 'warning' : 'note',
      message: { text: a.text },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: a.path },
            ...(a.line ? { region: { startLine: a.line } } : {}),
          },
          logicalLocations: [{ name: a.name, kind: 'function' }],
        },
      ],
      properties: { id: a.id, change: a.change },
    });
  }
  for (const r of rows) {
    const counts = r.renders;
    if (!counts || counts.settled !== false) continue;
    if (!rules.has(STILL))
      rules.set(STILL, {
        id: STILL,
        shortDescription: { text: 'React was still committing when pxsig captured the entry' },
        properties: { tags: ['react', 'renders'] },
      });
    const e = entries.get(r.id);
    results.push({
      ruleId: STILL,
      level: 'note',
      message: {
        text: `${r.id}: React was still committing when pxsig captured it (${counts.mount.commits} commits).`,
      },
      locations: [
        {
          ...(e?.importPath
            ? { physicalLocation: { artifactLocation: { uri: e.importPath } } }
            : {}),
          logicalLocations: [{ name: r.id, kind: 'module' }],
        },
      ],
      properties: { id: r.id, change: 'still-rendering' },
    });
  }
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'pxsig',
            ...(version ? { version } : {}),
            informationUri: 'https://github.com/hydrotik/pxsig',
            rules: [...rules.values()],
          },
          ...(backend
            ? {
                extensions: [
                  {
                    name: backend.name === 'oxc' ? OXC : COMPILER,
                    version: backend.compiler,
                    properties: { builtIn: backend.name === 'oxc' },
                  },
                ],
              }
            : {}),
        },
        results,
      },
    ],
  };
}

/**
 * Write the log; returns the number of results.
 * @param {string} path
 * @param {ReactSarifInput} input
 */
export function writeReactSarif(path, input) {
  const log = reactSarifLog(input);
  writeAtomic(path, `${JSON.stringify(log, null, 2)}\n`);
  return log.runs[0].results.length;
}
