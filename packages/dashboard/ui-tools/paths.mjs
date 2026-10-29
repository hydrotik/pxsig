/** Where the dashboard's files are (ui-tools.mjs), for every part of ui-tools/. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const dashboardDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const srcDir = path.join(dashboardDir, 'src');
export const uiDir = path.join(srcDir, 'ui');
export const manifestFile = path.join(uiDir, 'manifest.json');

export const repoRoot = path.resolve(dashboardDir, '..', '..');
export const docsDir = path.join(repoRoot, 'docs', 'ui');
export const featuresMdFile = path.join(docsDir, 'features.md');
export const buildPromptFile = path.join(docsDir, 'build-adapter.md');
