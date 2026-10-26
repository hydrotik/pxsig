/** paths.mjs — the one way pxsig prints and stores a path: `/`-separated on every OS. */
import { sep } from 'node:path';

export const toPosix = (p) => p.split(sep).join('/');
