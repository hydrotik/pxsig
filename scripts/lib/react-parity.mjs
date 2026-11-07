/**
 * lib/react-parity.mjs — how the built-in React Compiler's answers compare with the Babel plugin's,
 * per function (scripts/react-parity.mjs runs both). Pure: no files, no processes.
 *
 * A function is matched by the line it starts on. "Same compile result" is the parity gate's
 * measure (both compiled it, or neither did); every function whose outcome differs is listed.
 */

/** @import { CompileResult, ReactFunction } from '../../packages/pxsig/src/types/react.js' */

/**
 * @typedef {{ files: number, functions: number, compiledSame: number, outcomeSame: number,
 *   differences: string[] }} CorpusParity
 */

/** Babel's parser plugins for a file, by extension: the engine's `react-plan` `parser`. */
export function parserOf(/** @type {string} */ path) {
  if (path.endsWith('.tsx')) return ['jsx', 'typescript'];
  if (/\.(c|m)?ts$/.test(path)) return ['typescript'];
  return ['jsx'];
}

/** The fixture corpus leaves out Flow files: neither side is asked to parse Flow. */
export function isFlow(/** @type {string} */ path, /** @type {string} */ text) {
  return /flow/i.test(path.slice(path.lastIndexOf('/') + 1)) || text.includes('@flow');
}

/**
 * @param {CompileResult | undefined} r
 * @returns {ReactFunction[] | null}
 */
const fns = (r) => (r && 'functions' in r ? r.functions : null);

/**
 * Compare one corpus: `babel` and `oxc` hold each file's answer by its path in the corpus.
 * @param {Map<string, CompileResult>} babel
 * @param {Map<string, CompileResult>} oxc
 * @returns {CorpusParity}
 */
export function compareCorpus(babel, oxc) {
  /** @type {CorpusParity} */
  const out = { files: 0, functions: 0, compiledSame: 0, outcomeSame: 0, differences: [] };
  for (const [path, b] of [...babel].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    const o = oxc.get(path);
    out.files++;
    const fb = fns(b);
    const fo = fns(o);
    if (!fb || !fo) {
      const label = (/** @type {CompileResult | undefined} */ r) =>
        r && 'error' in r ? r.error : r ? 'ok' : 'missing';
      if (label(b) !== label(o)) out.differences.push(`${path} (file) ${label(b)} -> ${label(o)}`);
      continue;
    }
    const lines = [...new Set([...fb, ...fo].map((f) => f.line))].sort((x, y) => x - y);
    for (const line of lines) {
      const x = fb.find((f) => f.line === line);
      const y = fo.find((f) => f.line === line);
      const bo = x?.outcome ?? '(none)';
      const oo = y?.outcome ?? '(none)';
      out.functions++;
      if ((bo === 'compiled') === (oo === 'compiled')) out.compiledSame++;
      if (bo === oo) out.outcomeSame++;
      else out.differences.push(`${path}:${line} ${x?.name ?? y?.name ?? '?'} ${bo} -> ${oo}`);
    }
  }
  return out;
}

/** The share of functions with the same compile result, rounded down to one decimal. */
export function percent(/** @type {CorpusParity} */ p) {
  return (p.functions ? Math.floor((1000 * p.compiledSame) / p.functions) / 10 : 100).toFixed(1);
}

/**
 * The report's Markdown table.
 * @param {Record<string, CorpusParity>} corpora
 * @param {{ babel: string, oxc: string }} versions
 */
export function table(corpora, versions) {
  const rows = Object.entries(corpora).map(
    ([name, p]) =>
      `| ${name} | ${p.files} | ${p.functions} | ${p.compiledSame} (${percent(p)}%) | ${p.outcomeSame} | ${p.differences.length} |`
  );
  return [
    `Built-in compiler (${versions.oxc}) against ${versions.babel}:`,
    '',
    '| Corpus | Files | Functions | Same compile result | Same outcome | Differences |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}
