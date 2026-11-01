/**
 * Every dashboard feature, as data: where it lives, what it is for, the states it shows, how it is
 * used, its copy, the contract components it renders and the files that implement it.
 * docs/ui/features.md is generated from this file (`pnpm ui:docs`), and `pnpm ui:check` fails when
 * an entry names a component, file or copy key that does not exist, when a listed component is not
 * imported by one of the feature's files, or when a view or contract component belongs to no
 * feature.
 *
 * Plain data, one file per group of sections under features/, with type-only imports otherwise, so
 * Node reads it without a build (type stripping).
 */
import type { ComponentName } from './contract';
import { INSPECTOR } from './features/inspector.ts';
import { OVERVIEW } from './features/overview.ts';
import { REVIEW } from './features/review.ts';
import { SHELL } from './features/shell.ts';

export type Section =
  | 'shell'
  | 'overview'
  | 'review'
  | 'coverage'
  | 'a11y'
  | 'runs'
  | 'diagnostics'
  | 'help'
  | 'inspector'
  | 'embed';
export type State =
  | 'loading'
  | 'empty'
  | 'error'
  | 'offline'
  | 'static'
  | 'readOnly'
  | 'canApprove';

export interface Feature {
  id: string;
  section: Section;
  title: string;
  purpose: string;
  /** What the feature shows in each state it handles. */
  states: Partial<Record<State, string>>;
  /** What a person does with it; `keys` are keyboard shortcuts. */
  interactions: { action: string; keys?: string }[];
  /** Copy keys (or key prefixes) in src/copy/en.json. */
  copy: string[];
  components: ComponentName[];
  /** Source files under src/, without the extension. */
  files: string[];
  /**
   * What `pxsig dashboard check` renders for this feature, each in every theme: a scenario from
   * fixtures/scenarios.mjs, the address (`query`, `hash`), clicks or keys to get there, and the
   * landmark that says the feature rendered. `pnpm ui:check` fails a feature without one.
   */
  screens: Screen[];
  /**
   * Elements that must not move: each is in the same place and size on every screen of the
   * feature where it shows, and its box is committed (packages/dashboard/fixtures/locked/
   * geometry.json, scripts/screens-check.mjs). Change one on purpose with
   * `pnpm screens:check --update-locks`.
   */
  anchors?: Anchor[];
}

/** An element whose box is locked, found like a screen's landmark. */
export interface Anchor {
  name: string;
  target: Target;
}

/** An element found by role and accessible name (a substring unless `exact`), or by its text. */
export type Target =
  | { role: string; name?: string; exact?: boolean }
  | { text: string; exact?: boolean };

export interface Screen {
  scenario: string;
  /** The state of `states` this screen shows, when it shows one. */
  state?: State;
  /** The query string, without `?` (`embed=1&story=…`); the check adds `theme`. */
  query?: string;
  /** The hash, with `#` (`#overview`, `#inspect=<id>`). */
  hash?: string;
  actions?: ({ click: Target } | { press: string })[];
  wait: Target;
}

export const FEATURES: Feature[] = [...SHELL, ...OVERVIEW, ...REVIEW, ...INSPECTOR];
