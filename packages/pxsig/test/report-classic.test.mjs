/**
 * The static report is made from the dashboard's classic build (classic/: one classic script, which
 * also runs from disk), not from the served module build beside it; a folder without one (made by
 * hand) is used as it is.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dashboardDir, pageWithData, reportDashboardDir, useDashboard } from '../src/report.mjs';

const page = (/** @type {string} */ script) =>
  `<!doctype html><head><!--pxsig:data-->${script}</head><body><div id="root"></div></body>`;

test('the static report takes the classic build; a folder without one as it is', () => {
  const saved = dashboardDir;
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-report-classic-'));
  try {
    writeFileSync(
      join(dir, 'index.html'),
      page('<script type="module" crossorigin src="./assets/app.js"></script>')
    );
    useDashboard(dir);
    assert.equal(reportDashboardDir(), dir, 'no classic/: the folder itself');
    mkdirSync(join(dir, 'classic', 'assets'), { recursive: true });
    writeFileSync(
      join(dir, 'classic', 'index.html'),
      page('<script defer src="./assets/app.js"></script>')
    );
    assert.equal(reportDashboardDir(), join(dir, 'classic'));
    const html = pageWithData(/** @type {any} */ ({ project: 'demo' }));
    assert.match(html, /<script defer src="\.\/assets\/app\.js"><\/script>/);
    assert.doesNotMatch(html, /type="module"/);
    assert.match(html, /<script id="pxsig-data">window\.PXSIG=\{"project":"demo","static":true\}/);
  } finally {
    useDashboard(saved);
    rmSync(dir, { recursive: true, force: true });
  }
});
