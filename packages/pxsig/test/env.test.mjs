/**
 * env.test.mjs — the render environment (lib/env.mjs): what is collected (and what never is), the
 * compare classes, `env.ignore`, the rows and summary a check writes, the `env-mismatch` setup
 * finding, the server writing the row's environment into an approved baseline, and
 * `--strict-env` refusing before anything renders.
 *
 *   node --test packages/pxsig/test/env.test.mjs
 */
import assert from 'node:assert/strict';
import { hostname, userInfo } from 'node:os';
import { test } from 'node:test';
import {
  annotateRow,
  collectEnv,
  compareEnv,
  describeDiff,
  envConfig,
  envId,
  envLine,
  envSummary,
  gpuClass,
} from '../src/lib/env.mjs';
import { env, stubBrowser } from './env-helpers.mjs';
/** @import { EnvFields } from '../src/types.js' */

test('compare classes, from a table of pairs', () => {
  const base = env();
  /** @type {[EnvFields, string, string[] | undefined][]} */
  const cases = [
    [env(), 'same', undefined],
    [
      env({ node: 'v24.1.0', pxsig: '0.5.1', playwright: '1.59.0' }),
      'compatible',
      ['playwright', 'pxsig', 'node'],
    ],
    [env({ browser: { version: '141.0.7390.99' } }), 'compatible', ['browser.version']],
    [
      env({ os: { release: '6.9.1', distro: 'Debian 12' } }),
      'compatible',
      ['os.release', 'os.distro'],
    ],
    [env({ fonts: { system: 'f2' } }), 'compatible', ['fonts.system']],
    [
      env({ container: { image: 'ghcr.io/hydrotik/pxsig', revision: 'r1', digest: null } }),
      'compatible',
      ['container.image', 'container.revision'],
    ],
    [env({ browser: { version: '142.0.7444.10' } }), 'mismatch', ['browser.version']],
    [env({ browser: { channel: 'chrome' } }), 'mismatch', ['browser.channel']],
    [env({ os: { platform: 'darwin' } }), 'mismatch', ['os.platform']],
    [env({ render: { gpu: 'angle-metal' } }), 'mismatch', ['render.gpu']],
    [env({ render: { timezone: 'America/New_York' } }), 'mismatch', ['render.timezone']],
    [env({ capture: { pipeline: 2 } }), 'mismatch', ['capture.pipeline']],
  ];
  for (const [cur, match, diff] of cases) {
    const c = compareEnv(base, cur);
    assert.equal(c.match, match, JSON.stringify(diff));
    assert.deepEqual(c.diff, diff);
  }
  assert.deepEqual(
    compareEnv(null, base),
    { match: 'unknown' },
    'a baseline without env is unknown'
  );
  assert.deepEqual(compareEnv(undefined, base), { match: 'unknown' });
});

test('a font difference names the family; env.ignore leaves fields out', () => {
  const base = env();
  const cur = env({
    fonts: {
      probe: {
        digest: 'd2',
        families: { ...base.fonts.probe.families, 'sans-serif': 'eeeeeeee', Inter: '12345678' },
      },
    },
  });
  const c = compareEnv(base, cur);
  assert.equal(c.match, 'mismatch');
  assert.deepEqual(c.fonts, ['Inter', 'sans-serif']);
  assert.deepEqual(describeDiff(base, cur, c), ['fonts.probe: Inter, sans-serif']);
  const tz = env({ render: { timezone: 'Asia/Tokyo' } });
  assert.equal(
    compareEnv(base, tz, ['render.timezone']).match,
    'same',
    'an ignored field is not compared'
  );
  assert.equal(
    compareEnv(base, env({ render: { timezone: 'Asia/Tokyo', locale: 'ja-JP' } }), [
      'render.timezone',
    ]).match,
    'mismatch'
  );
  assert.deepEqual(
    describeDiff(base, env({ browser: { version: '142.1' } }), { diff: ['browser.version'] }),
    ['browser.version 141→142']
  );
  assert.deepEqual(
    envConfig({ env: { ignore: ['render.locale'], fontProbe: ['Inter'], strict: true } }),
    { ignore: ['render.locale'], fontProbe: ['Inter'], strict: true }
  );
  assert.deepEqual(envConfig({}), { ignore: [], fontProbe: [], strict: false });
});

test('the id covers the major fields only', () => {
  assert.equal(
    env().id,
    env({ node: 'v99', pxsig: '9.9.9', os: { release: 'x' }, fonts: { system: null } }).id
  );
  assert.equal(
    env().id,
    env({ browser: { version: '141.9.9' } }).id,
    'the minor part of the browser version'
  );
  assert.notEqual(env().id, env({ browser: { version: '142.0' } }).id);
  assert.notEqual(env().id, env({ render: { locale: 'de-DE' } }).id);
  assert.match(env().id, /^[0-9a-f]{16}$/);
});

test('the GPU becomes a class; the renderer string is never kept', () => {
  assert.equal(
    gpuClass('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'),
    'swiftshader'
  );
  assert.equal(
    gpuClass('ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)'),
    'angle-metal'
  );
  assert.equal(
    gpuClass('ANGLE (NVIDIA, Vulkan 1.3.277 (NVIDIA GeForce RTX 4090))'),
    'angle-vulkan'
  );
  assert.equal(
    gpuClass('ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)'),
    'angle-gl'
  );
  assert.equal(gpuClass(''), 'masked');
  assert.equal(gpuClass(null), 'none');
});
test('the collector: every field, a stable id, and nothing that names the machine or a person', async () => {
  const b = stubBrowser();
  const e = await collectEnv(b, {
    channel: 'chrome',
    fontProbe: ['Inter'],
    playwright: '1.58.2',
    pxsig: '0.5.0',
    engine: '0.5.0',
    env: { PXSIG_IMAGE: 'ghcr.io/hydrotik/pxsig', PXSIG_IMAGE_REVISION: 'abc' },
  });
  assert.equal(b.closed(), 1, 'the probe context is closed');
  assert.equal(e.v, 1);
  assert.deepEqual(e.browser, {
    name: 'chromium',
    version: '141.0.7390.37',
    channel: 'chrome',
    launchArgs: [],
  });
  assert.equal(e.render.gpu, 'angle-metal');
  assert.deepEqual(Object.keys(e.fonts.probe.families).sort(), [
    'Inter',
    'monospace',
    'sans-serif',
    'serif',
    'system-ui',
  ]);
  assert.ok(Object.values(e.fonts.probe.families).every((d) => /^[0-9a-f]{8}$/.test(d)));
  assert.deepEqual(e.container, { image: 'ghcr.io/hydrotik/pxsig', revision: 'abc', digest: null });
  assert.equal(e.capture.pipeline, 1);
  assert.equal(e.id, envId(e));
  const text = JSON.stringify(e);
  assert.ok(!text.includes('Apple M3'), 'the GPU model string is not kept');
  assert.ok(!text.includes(hostname()), 'no host name');
  const user = (() => {
    try {
      return userInfo().username;
    } catch {
      return null;
    }
  })();
  if (user && user.length > 3) assert.ok(!text.includes(user), 'no user name');
  for (const k of ['hostname', 'host', 'user', 'username', 'email', 'home'])
    assert.ok(!(k in e) && !(k in e.os), `no ${k}`);
  const again = await collectEnv(stubBrowser(), { channel: 'chrome', fontProbe: ['Inter'] });
  assert.equal(again.id, e.id, 'the same facts give the same id');
});

test('rows and the summary: envMatch per row, a count, and a line only when something mismatches', () => {
  const base = env();
  const cur = env({ browser: { version: '142.0.1' } });
  const envs = { [base.id]: base, [cur.id]: cur };
  const current = { chromium: cur };
  const rows = [
    annotateRow(
      { id: 'a', browser: 'chromium', pass: true, baselineEnv: base.id },
      { current, envs }
    ),
    annotateRow({ id: 'b', browser: 'chromium', pass: true, baselineEnv: null }, { current, envs }),
    annotateRow({ id: 'c', skipped: true }, { current, envs }),
    annotateRow(
      { id: 'd', browser: 'chromium', pass: true, baselineEnv: cur.id },
      { current, envs }
    ),
  ];
  assert.equal(rows[0].envMatch, 'mismatch');
  assert.deepEqual(rows[0].envDiff, ['browser.version']);
  assert.equal(rows[0].env, cur.id);
  assert.equal(rows[1].envMatch, 'unknown', 'no baseline env: unknown');
  assert.equal(rows[2].envMatch, undefined, 'a carried row is left as it is');
  assert.equal(rows[3].envMatch, 'same');
  assert.equal(rows[3].envDiff, undefined);
  const s = envSummary(rows, envs);
  assert.deepEqual(s, { envMismatch: 1, envFields: ['browser.version 141→142'] });
  assert.equal(
    envLine(s, 3),
    'env: 1 of 3 entries rendered in a different environment than their baseline (browser.version 141→142) → pxsig doctor'
  );
  assert.deepEqual(envSummary(rows.slice(1), envs), { envMismatch: 0 });
  assert.equal(envLine({ envMismatch: 0 }, 3), null);
});
