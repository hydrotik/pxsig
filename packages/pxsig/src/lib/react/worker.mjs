/**
 * lib/react/worker.mjs — one worker thread of the React analysis pool (pool.mjs): compiles one
 * file at a time with the project's own React Compiler and Babel, and turns the compiler's logger
 * events into per-function results (`{ functions }`, the engine's `react-diff` input).
 *
 * Never loads the project's Babel config (it is code): `babelrc`, `configFile` and the browserslist
 * config are off; the compiler options come from pxsig.config.json only. `noEmit`: nothing is
 * written. The file name Babel sees is workspace-relative and `cwd` is the workspace root, and no
 * location's file name leaves this worker.
 *
 * Two passes when `react.lint` is on: the first with the project's own options decides each
 * function's outcome (compiled or skipped, as the project's build would); the second adds the
 * validations eslint-plugin-react-hooks runs, and what it reports for a function the first pass
 * compiled is a finding (`stops: false`): the function compiles, the Rules-of-React problem is real.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

/** @import { CompileResult, ReactDiagnostic, ReactFunction } from '../../types/react.js' */

/**
 * The parts of Babel's AST and paths this file reads.
 * @typedef {{ line: number, column: number }} Pos
 * @typedef {{ start: Pos, end: Pos }} Loc
 * @typedef {{ type: string, loc?: Loc | null, id?: AstNode | null, key?: AstNode | null, name?: string, value?: unknown, left?: AstNode | null }} AstNode
 * @typedef {{ node: AstNode, parentPath: BabelPath | null }} BabelPath
 * @typedef {{ line: number, column: number, endLine: number, endColumn: number, name: string | null }} Span
 * @typedef {{ kind: string, fnLoc?: Loc | null, fnName?: string | null, memoSlots?: number, detail?: Record<string, unknown> & { options?: Record<string, unknown> } }} LoggerEvent
 * @typedef {{ transformSync: (code: string, opts: Record<string, unknown>) => unknown, version?: string }} Babel
 * @typedef {{ loc: Loc, name: string | null, success: boolean, skip: boolean, pipeline: boolean, memoSlots?: number, diags: ReactDiagnostic[] }} Rec
 */

/** The validations eslint-plugin-react-hooks turns on: the findings `react.lint` adds. */
const LINT = {
  validateRefAccessDuringRender: true,
  validateNoSetStateInRender: true,
  validateNoSetStateInEffects: true,
  validateNoJSXInTryStatements: true,
  validateNoImpureFunctionsInRender: true,
  validateStaticComponents: true,
  validateNoFreezingKnownMutableFunctions: true,
  validateNoVoidUseMemo: true,
  validateHooksUsage: true,
  validateNoDerivedComputationsInEffects: true,
};
const KNOWN = new Set([
  'CompileSuccess',
  'CompileError',
  'CompileDiagnostic',
  'CompileSkip',
  'PipelineError',
  'Timing',
  'AutoDepsDecorations',
  'AutoDepsEligible',
]);

/**
 * @param {AstNode | null | undefined} k
 * @returns {string | null}
 */
const keyName = (k) =>
  k?.type === 'Identifier' ? (k.name ?? null) : typeof k?.value === 'string' ? k.value : null;

/**
 * A function's name from its declaration, its variable (through `memo(…)` / `forwardRef(…)`), its
 * object or class key, or `default` for an anonymous default export.
 * @param {BabelPath} path
 * @returns {string | null}
 */
export function nameOf(path) {
  const n = path.node;
  if (n.id?.name) return n.id.name;
  if (n.key) return keyName(n.key);
  let p = path.parentPath;
  while (p && p.node.type === 'CallExpression') p = p.parentPath;
  if (!p) return null;
  const t = p.node.type;
  if (t === 'VariableDeclarator')
    return p.node.id?.type === 'Identifier' ? (p.node.id.name ?? null) : null;
  if (t === 'ObjectProperty' || t === 'ClassProperty') return keyName(p.node.key);
  if (t === 'AssignmentExpression')
    return p.node.left?.type === 'Identifier' ? (p.node.left.name ?? null) : null;
  if (t === 'ExportDefaultDeclaration') return 'default';
  return null;
}

/**
 * The reason, category, severity and location of a compiler diagnostic, whichever class it is.
 * @param {Record<string, unknown> & { options?: Record<string, unknown> }} d
 */
function detailOf(d) {
  const o = d.options ?? {};
  /** @type {Loc | null} */
  let loc = null;
  try {
    loc = /** @type {Loc | null} */ (
      typeof d.primaryLocation === 'function'
        ? /** @type {() => unknown} */ (d.primaryLocation).call(d)
        : (d.loc ?? o.loc ?? null)
    );
  } catch {
    // no location
  }
  if (!loc?.start) {
    const first = /** @type {{ loc?: Loc }[] | undefined} */ (o.details)?.find(
      (x) => x?.loc?.start
    );
    loc = first?.loc ?? null;
  }
  /** @param {unknown} v */
  const str = (v) => (typeof v === 'string' ? v : null);
  return {
    category: str(d.category) ?? str(o.category) ?? '',
    reason: str(d.reason) ?? str(o.reason) ?? '',
    severity: str(d.severity) ?? str(o.severity),
    loc: loc?.start ? loc : null,
  };
}

/** @param {Pos} p */
const posKey = (p) => `${p.line}:${p.column}`;

/**
 * @param {{ line: number, column: number, endLine: number, endColumn: number }} s
 * @param {Pos} at
 */
const contains = (s, at) =>
  (at.line > s.line || (at.line === s.line && at.column >= s.column)) &&
  (at.line < s.endLine || (at.line === s.endLine && at.column <= s.endColumn));

/** @param {Loc} l */
const spanOf = (l) => ({
  line: l.start.line,
  column: l.start.column,
  endLine: l.end.line,
  endColumn: l.end.column,
});

/**
 * Per-function records from one pass's events. An event with no function location (a validation
 * the compiler reports for the whole file) belongs to the innermost function the compiler reported
 * that contains the diagnostic, else to the innermost function there.
 * @param {LoggerEvent[]} events
 * @param {Span[]} spans
 * @param {Map<string, string>} rules category → lint rule name
 * @returns {Map<string, Rec>}
 */
export function records(events, spans, rules) {
  /** @type {Map<string, Rec>} */
  const recs = new Map();
  /** @param {Loc} loc */
  const recAt = (loc, /** @type {string | null | undefined} */ fnName) => {
    const k = posKey(loc.start);
    let r = recs.get(k);
    if (!r) {
      const span = spans.find((s) => s.line === loc.start.line && s.column === loc.start.column);
      r = {
        loc,
        name: span?.name ?? fnName ?? null,
        success: false,
        skip: false,
        pipeline: false,
        diags: [],
      };
      recs.set(k, r);
    }
    return r;
  };
  /**
   * A function location as the spans have it: a skip's location is the function's body, so a
   * location no function starts at is the innermost function holding it.
   * @param {Loc} loc
   * @returns {Loc}
   */
  const fnAt = (loc) => {
    if (spans.some((s) => s.line === loc.start.line && s.column === loc.start.column)) return loc;
    const s = spans
      .filter((x) => contains(x, loc.start))
      .sort((a, b) => b.line - a.line || b.column - a.column)[0];
    return s
      ? { start: { line: s.line, column: s.column }, end: { line: s.endLine, column: s.endColumn } }
      : loc;
  };
  const relevant = events.filter((e) => e.kind !== 'Timing' && !e.kind.startsWith('AutoDeps'));
  for (const e of relevant) if (e.fnLoc?.start) recAt(fnAt(e.fnLoc), e.fnName);
  /** @param {Pos} at */
  const owner = (at) => {
    const known = [...recs.values()]
      .filter((r) => contains(spanOf(r.loc), at))
      .sort(
        (a, b) => b.loc.start.line - a.loc.start.line || b.loc.start.column - a.loc.start.column
      )[0];
    if (known) return known.loc;
    const s = spans
      .filter((x) => contains(x, at))
      .sort((a, b) => b.line - a.line || b.column - a.column)[0];
    return s
      ? { start: { line: s.line, column: s.column }, end: { line: s.endLine, column: s.endColumn } }
      : null;
  };
  for (const e of relevant) {
    const d = e.detail ? detailOf(e.detail) : null;
    const loc = e.fnLoc?.start ? fnAt(e.fnLoc) : d?.loc ? owner(d.loc.start) : null;
    if (!loc) continue;
    const r = recAt(loc, e.fnName);
    if (e.kind === 'CompileSuccess') {
      r.success = true;
      if (typeof e.memoSlots === 'number') r.memoSlots = e.memoSlots;
      r.name ??= e.fnName ?? null;
    } else if (e.kind === 'CompileSkip') r.skip = true;
    else if (e.kind === 'PipelineError') r.pipeline = true;
    else if (!KNOWN.has(e.kind)) {
      r.pipeline = true;
      r.diags.push({
        rule: '',
        category: 'Unknown',
        reason: `the compiler logged an unknown event: ${e.kind}`,
        line: null,
        severity: null,
        stops: true,
      });
    } else if (d) {
      /** @type {ReactDiagnostic} */
      const diag = {
        rule: rules.get(d.category) ?? '',
        category: d.category,
        reason: d.reason,
        line: d.loc?.start.line ?? null,
        severity: d.severity,
        stops: e.kind === 'CompileError',
      };
      if (
        !r.diags.some(
          (x) => x.rule === diag.rule && x.reason === diag.reason && x.line === diag.line
        )
      )
        r.diags.push(diag);
    }
  }
  return recs;
}

/**
 * The functions of one file from the build pass and (with lint) the lint pass.
 * @param {Map<string, Rec>} build
 * @param {Map<string, Rec> | null} lint
 * @returns {ReactFunction[]}
 */
export function functions(build, lint) {
  /** @type {ReactFunction[]} */
  const out = [];
  let anonymous = 0;
  const recs = [...build.values()].sort(
    (a, b) => a.loc.start.line - b.loc.start.line || a.loc.start.column - b.loc.start.column
  );
  for (const r of recs) {
    const compiled = r.success && !r.pipeline && !r.skip;
    /** @type {ReactFunction['outcome']} */
    const outcome = r.pipeline
      ? 'compiler-error'
      : r.skip
        ? 'opted-out'
        : compiled
          ? 'compiled'
          : 'bailout';
    if (outcome === 'bailout' && !r.diags.some((d) => d.stops)) continue;
    /** @type {ReactDiagnostic[]} */
    let diagnostics =
      outcome === 'bailout' || outcome === 'compiler-error' ? r.diags.filter((d) => d.stops) : [];
    if (compiled && lint) {
      const l = lint.get(posKey(r.loc.start));
      const findings = [...r.diags, ...(l?.diags ?? [])].map((d) => ({ ...d, stops: false }));
      for (const f of findings)
        if (
          !diagnostics.some((x) => x.rule === f.rule && x.reason === f.reason && x.line === f.line)
        )
          diagnostics.push(f);
    }
    if (outcome === 'opted-out') diagnostics = [];
    const name = r.name ?? `anonymous-${++anonymous}`;
    out.push({
      name,
      kind: /^use[A-Z0-9]/.test(name) ? 'hook' : 'component',
      line: r.loc.start.line,
      endLine: r.loc.end.line,
      outcome,
      ...(compiled && r.memoSlots != null ? { memoSlots: r.memoSlots } : {}),
      diagnostics,
    });
  }
  return out;
}

/**
 * Compile one file side and answer its functions.
 * @param {{ babel: Babel, compiler: unknown, rules: Map<string, string>, options: { compilationMode: string, target: string, environment: Record<string, unknown>, lint: boolean }, cwd: string }} env
 * @param {{ path: string, text: string, parser: string[] }} file
 * @returns {CompileResult}
 */
export function compile(env, { path, text, parser }) {
  /** @type {Span[]} */
  const spans = [];
  /** A pre-pass plugin: every function's span and name, for the events that carry only a location. */
  const spansPlugin = () => ({
    visitor: {
      /** @param {BabelPath} p */
      Function(p) {
        const loc = p.node.loc;
        if (loc)
          spans.push({
            line: loc.start.line,
            column: loc.start.column,
            endLine: loc.end.line,
            endColumn: loc.end.column,
            name: nameOf(p),
          });
      },
    },
  });
  /**
   * @param {Record<string, unknown>} environment
   * @param {boolean} withSpans
   */
  const pass = (environment, withSpans) => {
    /** @type {LoggerEvent[]} */
    const events = [];
    env.babel.transformSync(text, {
      filename: path,
      cwd: env.cwd,
      babelrc: false,
      configFile: false,
      browserslistConfigFile: false,
      sourceType: 'module',
      code: false,
      ast: false,
      parserOpts: { plugins: parser },
      plugins: [
        ...(withSpans ? [spansPlugin] : []),
        [
          env.compiler,
          {
            noEmit: true,
            panicThreshold: 'none',
            compilationMode: env.options.compilationMode,
            target: env.options.target,
            environment,
            logger: {
              logEvent: (/** @type {unknown} */ _f, /** @type {LoggerEvent} */ e) => events.push(e),
            },
          },
        ],
      ],
    });
    return events;
  };
  try {
    const build = records(pass(env.options.environment, true), spans, env.rules);
    const lint = env.options.lint
      ? records(pass({ ...env.options.environment, ...LINT }, false), spans, env.rules)
      : null;
    return { functions: functions(build, lint) };
  } catch {
    // A file Babel cannot parse, or a compiler that throws: no message (Babel's names the file's
    // absolute path).
    return { error: 'compiler-error' };
  }
}

/**
 * Load the project's Babel and compiler from the paths the pool resolved.
 * @param {{ babel: string, compiler: string }} paths
 */
export async function load(paths) {
  const b = /** @type {Babel & { default?: Babel }} */ (
    await import(pathToFileURL(paths.babel).href)
  );
  const c =
    /** @type {Record<string, unknown> & { default?: unknown, LintRules?: { category: string, name: string }[] }} */ (
      await import(pathToFileURL(paths.compiler).href)
    );
  const lintRules =
    c.LintRules ??
    /** @type {{ LintRules?: { category: string, name: string }[] } | undefined} */ (c.default)
      ?.LintRules ??
    [];
  return {
    babel: typeof b.transformSync === 'function' ? b : /** @type {Babel} */ (b.default),
    compiler: c.default ?? c,
    rules: new Map(lintRules.map((r) => [r.category, r.name])),
  };
}

if (parentPort && workerData) {
  const port = parentPort;
  const data =
    /** @type {{ babel: string, compiler: string, options: { compilationMode: string, target: string, environment: Record<string, unknown>, lint: boolean }, cwd: string }} */ (
      workerData
    );
  const ready = load(data);
  port.on(
    'message',
    async (/** @type {{ id: number, path: string, text: string, parser: string[] }} */ m) => {
      let result;
      try {
        result = compile({ ...(await ready), options: data.options, cwd: data.cwd }, m);
      } catch {
        // Babel or the compiler did not load.
        result = { error: 'compiler-error' };
      }
      port.postMessage({ id: m.id, result });
    }
  );
}
