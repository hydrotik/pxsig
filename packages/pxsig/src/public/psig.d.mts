/**
 * Types for `pxsig/psig` (../lib/psig.mjs): read `.psig` baselines (docs/spec.md). The header
 * shape comes from ../types.js, the same one pxsig's own JSDoc uses.
 */
import type { PsigHeader } from '../types.js';

export type { PsigHeader };

/** The header of a `.psig` (reads only the start of the file); null when it isn't one. */
export declare function readHeader(path: string): PsigHeader | null;
/** One section's bytes, or null. */
export declare function readSection(path: string, name: string): Buffer | null;
/** The baseline image (PNG bytes), or null. */
export declare function readImage(path: string): Buffer | null;
/** True when a `.psig` carries a baseline image (header only). */
export declare function hasImage(path: string): boolean;
