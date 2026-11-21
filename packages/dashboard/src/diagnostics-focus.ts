/**
 * diagnostics-focus.ts — Diagnostics opened on one of its parts. The sections folded into it keep
 * their links (`#react`, `#react-renders`, `#scenarios`, `#calibration`, `#performance`): each names
 * the part to show, on a load and when the hash changes on an open page alike.
 */

export type DiagnosticsSection = 'react' | 'scenarios' | 'calibration' | 'performance';

export interface DiagnosticsFocus {
  section: DiagnosticsSection;
  /** React's part: the Compiler or Renders. */
  part?: 'compiler' | 'renders';
  all?: boolean;
  fn?: string;
  /** When: a new focus opens Diagnostics there again (App keys the view by it). */
  at: number;
}

/** The part an old section link names, or null for any other hash value. */
export function focusOfHash(v: string | null): DiagnosticsFocus | null {
  const at = Date.now();
  if (v === 'react') return { section: 'react', part: 'compiler', at };
  if (v === 'react-renders') return { section: 'react', part: 'renders', at };
  if (v === 'scenarios' || v === 'calibration' || v === 'performance') return { section: v, at };
  return null;
}
