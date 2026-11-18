/**
 * Types for `pxsig/spawn` (./spawn.mjs): pxsig's guarded `spawnSync`. It throws for a program
 * pxsig does not start, or when asked for a shell.
 */
import type {
  SpawnSyncOptions,
  SpawnSyncOptionsWithStringEncoding,
  SpawnSyncReturns,
} from 'node:child_process';

/** Start a program pxsig may start, without a shell, and wait for it. */
export declare function spawnSync(
  program: string,
  args: readonly string[],
  opts: SpawnSyncOptionsWithStringEncoding
): SpawnSyncReturns<string>;
export declare function spawnSync(
  program: string,
  args?: readonly string[],
  opts?: SpawnSyncOptions
): SpawnSyncReturns<string | Buffer>;
