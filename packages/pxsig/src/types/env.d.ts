/**
 * types/env.d.ts — the environment record and its comparison (lib/env.mjs). Types only; types.d.ts
 * re-exports them.
 */
// --- env (lib/env.mjs; docs/configuration.md#env) ------------------------------------------------

/** A field's tier: a `major` difference is a mismatch, a `minor` one only compatible. */
export type EnvTier = 'major' | 'minor';

/** The render environment of one browser (`env`, `v` 1), as a `.psig` header and check.json keep it. */
export interface EnvRecord {
  v: number;
  /** First 16 hex of sha256 over the major fields (`envId`). */
  id: string;
  browser: { name: string; version: string | null; channel: string | null; launchArgs: string[] };
  playwright: string | null;
  /** The axe-core version of the a11y pass; absent in an env written by an older pxsig. */
  axe?: string | null;
  os: {
    platform: string | null;
    arch: string | null;
    release: string | null;
    distro: string | null;
  };
  fonts: {
    probe: { digest: string; families: Record<string, string> };
    system: string | null;
  };
  render: {
    dpr: number;
    gpu: string;
    colorGamut: string;
    timezone: string | null;
    locale: string | null;
    reducedMotion: string;
  };
  capture: { pipeline: number };
  container: { image: string | null; revision: string | null; digest: string | null } | null;
  pxsig: string | null;
  engine: string | null;
  node: string;
}

/** An env before its `id` is computed over it. */
export type EnvFields = Omit<EnvRecord, 'id'> & { id?: string };

/** What `collectEnv` uses of a Playwright Browser (tests pass a stand-in with only this). */
export interface EnvBrowser {
  newContext(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    reducedMotion: 'reduce';
  }): Promise<{
    newPage(): Promise<{
      setContent(html: string): Promise<unknown>;
      evaluate<A>(fn: (arg: A) => unknown, arg?: A): Promise<unknown>;
    }>;
    close(): Promise<unknown>;
  }>;
  browserType?(): { name?(): string };
  version?(): string;
}

/** The browser server this process connected to, and what `pxsig browser start` recorded for it. */
export interface RemoteBrowser {
  endpoint: string;
  record?: { image?: string | null; revision?: string | null; digest?: string | null } | null;
}

/** What `PROBE_PAGE` returns from the probe page. */
export interface EnvProbe {
  /** Family → text width per probe size. */
  widths: Record<string, number[]>;
  renderer: string | null;
  colorGamut: string;
  timezone: string | null;
  locale: string | null;
  platform: string | null;
}

/** How a baseline's env compares with a render's. */
export type EnvMatch = 'same' | 'compatible' | 'mismatch' | 'unknown';

/** What `compareEnv` returns. */
export interface EnvComparison {
  match: EnvMatch;
  /** The differing fields (only when not `same`). */
  diff?: string[];
  /** The font families, when `fonts.probe` differs. */
  fonts?: string[];
}

/** `summary.envMismatch` and `summary.envFields`, from `envSummary`. */
export interface EnvSummary {
  envMismatch: number;
  envFields?: string[];
}

/** The project's `env` settings with their defaults (`envConfig`). */
export interface EnvSettings {
  ignore: string[];
  fontProbe: string[];
  strict: boolean;
}
