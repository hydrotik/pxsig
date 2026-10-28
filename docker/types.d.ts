// Types for docker/smoke.mjs: what it uses of the pxsig installed in the image. That pxsig is
// loaded by path at run time, so these are the shapes smoke.mjs relies on, not imports of this
// checkout's modules (the image may ship an older pxsig).
import type { EnvRecord } from '../packages/pxsig/src/types.js';

/** `src/lib/env.mjs`, as far as smoke.mjs uses it. */
export interface SmokeEnvModule {
  systemFonts: (platform?: string) => string | null;
}

/** The pool `browserPool(null)` returns, as far as smoke.mjs uses it. */
export interface SmokeBrowserPool {
  env(type: string): Promise<EnvRecord>;
  close(): Promise<unknown>;
}

/** `src/lib/capture.mjs`, as far as smoke.mjs uses it. */
export interface SmokeCaptureModule {
  browserPool: (project: null) => SmokeBrowserPool;
}
