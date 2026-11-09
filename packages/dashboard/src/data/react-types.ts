/**
 * The React analysis as the server sends it (`data.react`, lib/react/data.mjs; `reports/react.json`,
 * docs/cli.md) and a row's render counts (`renders`, docs/spec.md "Render counts").
 */

/** One reason the React Compiler gave for a function. */
export interface ReactDiagnostic {
  /** The eslint-plugin-react-hooks rule name; "" when the compiler gave none (the category names it). */
  rule: string;
  category: string;
  reason: string;
  line: number | null;
  severity?: string | null;
  /** It made the compiler skip the function; false: a finding on a function that still compiles. */
  stops: boolean;
}

/** A function's outcome on one side. */
export interface ReactSide {
  outcome: 'compiled' | 'bailout' | 'opted-out' | 'compiler-error' | 'analysis-timeout';
  memoSlots?: number;
  diagnostics?: ReactDiagnostic[];
}

/** One component or hook in react.json: the base and now (null: absent there), and what changed. */
export interface ReactFunction {
  id: string;
  name: string;
  kind: 'component' | 'hook';
  line: number;
  base: ReactSide | null;
  head: ReactSide | null;
  /** Null when nothing was compared (no merge base). */
  change: string | null;
  alert: boolean;
}

/** One alert: the engine's sentence, shown as it is. */
export interface ReactAlert {
  kind: 'compiler';
  id: string;
  name: string;
  path: string;
  change: string;
  level: 'warning' | 'note';
  rule: string | null;
  line: number | null;
  text: string;
}

/** react.json's counts. */
export interface ReactSummary {
  files: number;
  functions: number;
  compiled: number;
  bailouts: number;
  newBailouts: number;
  findings: number;
  newFindings: number;
  fixed: number;
  optedOut: number;
  alerts: number;
  ms: number | null;
  cached: number;
}

/** `reports/react.json`. */
export interface ReactReport {
  v: number;
  generatedAt: string;
  project: string | null;
  /** The run's compiler: `babel` (babel-plugin-react-compiler, @babel/core) or `oxc` (built in: oxc_react_compiler, `babel` null). */
  backend: {
    name: 'babel' | 'oxc';
    compiler: string;
    babel: string | null;
    options: { compilationMode?: string; target?: string; lint?: boolean };
  };
  base: { since: string; commit: string } | null;
  /** `ids`: the entries the file reaches; null when it reaches every entry. */
  files: {
    path: string;
    entries: number;
    all?: boolean;
    ids?: string[] | null;
    head: string;
    base: string | null;
  }[];
  functions: ReactFunction[];
  alerts: ReactAlert[];
  skipped: { path: string; why: string }[];
  notes: string[];
  summary: ReactSummary;
}

/** `data.react`: where the analysis stands for the project, its last results and who wrote them. */
export interface ReactData {
  status: {
    compiler: 'ready' | 'off' | 'not-installed' | 'bad-config' | 'running' | 'skipped' | 'failed';
    renders: 'ready' | 'off';
    off: { where: 'config' | 'workspace' | 'flag' | 'env'; key: 'react' | 'react.compiler' } | null;
    missing: string[];
    configWarning: string | null;
    error: string | null;
    held: string | null;
    stale: { files: number; since: string } | null;
  };
  report: ReactReport | null;
  source: 'check' | 'server' | 'react-cli' | null;
}

/** One window's counts. */
export interface RenderPhase {
  commits: number;
  rendered: number | null;
  mounted?: number | null;
}

/** A row's `renders`; null when no React renderer loaded. */
export interface RenderCounts {
  v: 1;
  build: 'development' | 'production';
  react: string | null;
  mount: RenderPhase;
  interaction?: RenderPhase;
  top: { name: string; renders: number; compiled: boolean }[];
  ms?: number;
  settled: boolean;
  /** When the check that rendered the entry ran. */
  at?: string;
  /** The mount counts of the row this one replaced. */
  prev?: { commits: number; rendered: number | null; at: string | null };
}
