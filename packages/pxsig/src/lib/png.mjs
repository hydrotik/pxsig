/**
 * png.mjs — pngjs, loaded on first use. Loading it costs about as much as the rest of a read
 * command's start-up, and only the commands that read or write images need it (crops, the shape
 * classifier), so the modules that every command loads take it from here instead of importing it.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/** @type {typeof import('pngjs').PNG | undefined} */
let png;

/** pngjs's `PNG` class. */
export const PNG = () => (png ??= /** @type {typeof import('pngjs')} */ (require('pngjs')).PNG);
