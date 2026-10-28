/**
 * container.test.mjs — the container image's hooks into pxsig (docs/container.md): the image's own
 * Playwright (PXSIG_PLAYWRIGHT), rendering with a remote browser server (--browser,
 * PXSIG_BROWSER_WS, capture.browserEndpoint) and the environment it reports, `pxsig browser`
 * (with no Docker, and against a stand-in docker), and the `image-mismatch` setup warning. Without
 * any of the new flags or variables, nothing changes.
 *
 *   node --test packages/pxsig/test/container.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { browserCommand, defaultImage } from '../src/browser.mjs';
import { browserPool, browserRecord, connectBrowser } from '../src/lib/capture.mjs';
import { collectEnv, osFromProbe } from '../src/lib/env.mjs';
import {
  browserFile,
  flagLayer,
  imageProblems,
  openProject,
  parseImageTag,
  PXSIG_VERSION,
  resolvePeer,
} from '../src/lib/workspace.mjs';
import { fixture } from './fixture.mjs';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(pkg, 'bin', 'pxsig.mjs');

/**
 * A Playwright package folder with only a package.json and an entry.
 * @param {string} version
 */
function fakePlaywright(version) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pxsig-pw-')));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'playwright', version, main: 'index.js' })
  );
  writeFileSync(join(dir, 'index.js'), 'module.exports = {};\n');
  return dir;
}

test('PXSIG_PLAYWRIGHT is tried first for Playwright, and only for Playwright', () => {
  const dir = fakePlaywright('9.9.9');
  const P = { root: pkg, workspaceRoot: pkg };
  assert.equal(
    resolvePeer(P, 'playwright/package.json', { PXSIG_PLAYWRIGHT: dir }),
    join(dir, 'package.json')
  );
  assert.equal(resolvePeer(P, 'playwright', { PXSIG_PLAYWRIGHT: dir }), join(dir, 'index.js'));
  const own = resolvePeer(P, 'playwright/package.json', {});
  assert.notEqual(own, join(dir, 'package.json'), 'unset: the project’s Playwright, as before');
  assert.equal(
    resolvePeer(P, 'axe-core/package.json', { PXSIG_PLAYWRIGHT: dir }),
    resolvePeer(P, 'axe-core/package.json', {}),
    'other peers are not affected'
  );
  // A folder that is not there: the next place, as before.
  assert.equal(
    resolvePeer(P, 'playwright/package.json', { PXSIG_PLAYWRIGHT: join(dir, 'nope') }),
    own
  );
});

test('--browser and PXSIG_BROWSER_WS set capture.browserEndpoint; the flag wins', () => {
  assert.deepEqual(flagLayer({ browser: 'ws://127.0.0.1:3000/' }).capture, {
    browserEndpoint: 'ws://127.0.0.1:3000/',
  });
  assert.deepEqual(flagLayer({ browser: 'ws://x/', 'settle-ms': '50' }).capture, {
    settleMs: 50,
    browserEndpoint: 'ws://x/',
  });
  assert.equal(flagLayer({}).capture, undefined);
  const f = fixture({ withSigs: false });
  const none = openProject({ cwd: f.repo, env: {}, flags: {} });
  assert.equal(none.config.capture.browserEndpoint, null, 'default: launch here');
  const env = openProject({ cwd: f.repo, env: { PXSIG_BROWSER_WS: 'ws://env/' }, flags: {} });
  assert.equal(env.config.capture.browserEndpoint, 'ws://env/');
  const flag = openProject({
    cwd: f.repo,
    env: { PXSIG_BROWSER_WS: 'ws://env/' },
    flags: flagLayer({ browser: 'ws://flag/' }),
  });
  assert.equal(flag.config.capture.browserEndpoint, 'ws://flag/');
});

/**
 * A stand-in Playwright whose engines record how they were opened.
 * @param {{ fail?: string | null }} [opts]
 */
function stubPlaywright({ fail = null } = {}) {
  /** @type {unknown[][]} */
  const calls = [];
  /** @param {string} type */
  const browser = (type) => ({
    type,
    version: () => '145.0.1',
    browserType: () => ({ name: () => type }),
    close: async () => calls.push(['close', type]),
  });
  /** @param {string} type */
  const engine = (type) => ({
    /**
     * @param {string} ws
     * @param {unknown} opts
     */
    connect: async (ws, opts) => {
      calls.push(['connect', type, ws, opts]);
      if (fail) throw new Error(fail);
      return browser(type);
    },
    launch: async (/** @type {unknown} */ opts) =>
      (calls.push(['launch', type, opts]), browser(type)),
  });
  return {
    calls,
    pw: { chromium: engine('chromium'), firefox: engine('firefox'), webkit: engine('webkit') },
  };
}

test('with an endpoint, every engine connects to it (localhost exposed, the engine in a header); without one, nothing changes', async () => {
  const { calls, pw } = stubPlaywright();
  // browserPool's `pw` defaults to null; it takes a Playwright module (here a stand-in).
  const pool =
    /** @type {(project: null, given: {}, opts: { endpoint?: string | null, pw?: unknown }) => ReturnType<typeof browserPool>} */ (
      browserPool
    )(null, {}, { endpoint: 'ws://127.0.0.1:3000/', pw });
  const c = await pool.get('chromium');
  await pool.get('firefox');
  assert.equal(c.__pxsigRemote, 'ws://127.0.0.1:3000/');
  assert.deepEqual(
    calls.filter((x) => x[0] === 'connect').map((x) => [x[1], x[2], x[3]]),
    [
      [
        'chromium',
        'ws://127.0.0.1:3000/',
        { exposeNetwork: '<loopback>', headers: { 'x-playwright-browser': 'chromium' } },
      ],
      [
        'firefox',
        'ws://127.0.0.1:3000/',
        { exposeNetwork: '<loopback>', headers: { 'x-playwright-browser': 'firefox' } },
      ],
    ]
  );
  assert.ok(!calls.some((x) => x[0] === 'launch'), 'nothing launched here');
  await pool.close();

  const local = stubPlaywright();
  const p2 =
    /** @type {(project: null, given: {}, opts: { endpoint?: string | null, pw?: unknown }) => ReturnType<typeof browserPool>} */ (
      browserPool
    )(null, {}, { endpoint: null, pw: local.pw });
  await p2.get('webkit');
  assert.deepEqual(
    local.calls.map((x) => x[0]),
    ['launch'],
    'no endpoint: launched, as before'
  );
  assert.equal(p2.endpoint, null);
});

test('a browser server that cannot be used is a setup error naming the endpoint', async () => {
  const { pw } = stubPlaywright({
    fail: 'browserType.connect: WebSocket error: connect ECONNREFUSED 127.0.0.1:3000\nCall log: …',
  });
  await assert.rejects(
    connectBrowser(pw, 'ws://127.0.0.1:3000/', 'chromium'),
    (/** @type {Error} */ e) => {
      assert.equal(e.constructor.name, 'SetupError');
      assert.match(
        e.message,
        /cannot use the browser server at ws:\/\/127\.0\.0\.1:3000\/ \(chromium\): browserType\.connect: WebSocket error: connect ECONNREFUSED/
      );
      assert.match(e.message, /pxsig browser status/);
      assert.ok(!e.message.includes('Call log'), 'one line');
      return true;
    }
  );
});

test("a remote browser's environment: its OS from the page, its image from the record, never this machine's fonts", async () => {
  assert.deepEqual(osFromProbe('Linux aarch64'), {
    platform: 'linux',
    arch: 'arm64',
    release: null,
    distro: null,
  });
  assert.deepEqual(osFromProbe('Linux x86_64'), {
    platform: 'linux',
    arch: 'x64',
    release: null,
    distro: null,
  });
  assert.equal(osFromProbe('MacIntel').platform, 'darwin');
  assert.equal(osFromProbe('Win32').platform, 'win32');
  assert.deepEqual(osFromProbe(null), { platform: null, arch: null, release: null, distro: null });
  const page = {
    setContent: async () => {},
    /**
     * The probe page's `evaluate`: only the font probe (`{ families }`) answers.
     * @template A
     * @param {(arg: A) => unknown} fn
     * @param {A} [arg]
     */
    evaluate: async (fn, arg) =>
      /** @type {{ families?: string[] } | undefined} */ (arg)?.families
        ? {
            widths: Object.fromEntries(
              // The condition above: `families` is set.
              /** @type {string[]} */ (/** @type {{ families?: string[] }} */ (arg).families).map(
                (f) => [f, [10, 13.333, 26.667]]
              )
            ),
            renderer: 'Google SwiftShader',
            colorGamut: 'srgb',
            timezone: 'UTC',
            locale: 'en-US',
            platform: 'Linux aarch64',
          }
        : null,
  };
  const b = {
    version: () => '145.0.1',
    browserType: () => ({ name: () => 'chromium' }),
    newContext: async () => ({ newPage: async () => page, close: async () => {} }),
  };
  const record = {
    ws: 'ws://127.0.0.1:3000/',
    image: 'ghcr.io/hydrotik/pxsig:0.5.0-pw1.58.2',
    digest: 'sha256:abc',
    revision: 'r1',
  };
  const e = await collectEnv(b, {
    remote: { endpoint: record.ws, record },
    env: { PXSIG_IMAGE: 'this machine’s, not the browser’s' },
  });
  assert.deepEqual(e.os, { platform: 'linux', arch: 'arm64', release: null, distro: null });
  assert.equal(e.fonts.system, null);
  assert.deepEqual(e.container, { image: record.image, revision: 'r1', digest: 'sha256:abc' });
  assert.equal(e.render.gpu, 'swiftshader');
  const bare = await collectEnv(b, { remote: { endpoint: 'ws://elsewhere/', record: null } });
  assert.equal(bare.container, null, 'no record for that endpoint: no image claimed');
  // Local (no remote): this machine, as before.
  const local = await collectEnv(b, { env: {} });
  assert.equal(local.os.platform, process.platform);
});

test('browserRecord reads browser.json only for the endpoint it recorded', () => {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-ws-'));
  mkdirSync(dirname(browserFile(root)), { recursive: true });
  writeFileSync(browserFile(root), JSON.stringify({ ws: 'ws://127.0.0.1:3000/', image: 'img' }));
  assert.equal(browserRecord({ workspaceRoot: root }, 'ws://127.0.0.1:3000/').image, 'img');
  assert.equal(browserRecord({ workspaceRoot: root }, 'ws://127.0.0.1:4000/'), null);
  assert.equal(browserRecord(null, 'ws://127.0.0.1:3000/'), null);
});

/** A stand-in for the docker CLI: answers by the first argument, records every call. */
function fakeDocker({
  missing = false,
  daemon = true,
  labels = {
    'io.pxsig.playwright': '1.58.2',
    'io.pxsig.version': '0.5.0',
    'org.opencontainers.image.revision': 'abc123',
  },
  ready = true,
} = {}) {
  /** @type {string[][]} */
  const calls = [];
  let up = false;
  /** @param {string[]} args */
  const docker = (args) => {
    calls.push(args);
    if (missing)
      return {
        status: null,
        stdout: '',
        stderr: '',
        missing: true,
        error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }),
      };
    const [cmd] = args;
    if (cmd === 'version')
      return daemon
        ? { status: 0, stdout: '27.3.1\n', stderr: '' }
        : {
            status: 1,
            stdout: '',
            stderr:
              'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n',
          };
    if (cmd === 'run') return ((up = true), { status: 0, stdout: 'c0ffee\n', stderr: '' });
    if (cmd === 'logs')
      return { status: 0, stdout: ready ? 'Listening on ws://0.0.0.0:3000/\n' : '', stderr: '' };
    if (cmd === 'inspect') return { status: 0, stdout: `${up}\n`, stderr: '' };
    if (cmd === 'image')
      return {
        status: 0,
        stdout: `${JSON.stringify(['ghcr.io/hydrotik/pxsig@sha256:feed'])}|${JSON.stringify(labels)}\n`,
        stderr: '',
      };
    if (cmd === 'stop') return ((up = false), { status: 0, stdout: '', stderr: '' });
    return { status: 0, stdout: '', stderr: '' };
  };
  return { docker, calls };
}

test('pxsig browser: status with nothing recorded never starts docker; start, status and stop against a stand-in docker', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-ws-'));
  const d = fakeDocker();
  const s0 = await browserCommand({ sub: 'status', root, docker: d.docker });
  assert.equal(s0.exit, 0);
  assert.equal(s0.data.record, null);
  assert.deepEqual(d.calls, [], 'no docker call without a record');

  const image = 'ghcr.io/hydrotik/pxsig:0.5.0-pw1.58.2';
  const r = await browserCommand({
    sub: 'start',
    flags: { image, port: '3123' },
    root,
    docker: d.docker,
  });
  assert.equal(r.exit, 0);
  // `start` ran `docker run` (r.exit is 0 above): the call is there.
  // (Through unknown: the deepEqual above narrowed `d.calls` to an empty array.)
  const run = /** @type {string[]} */ (
    /** @type {unknown} */ (d.calls.find((a) => a[0] === 'run'))
  );
  assert.deepEqual(
    run.slice(run.indexOf('-p'), run.indexOf('-p') + 2),
    ['-p', '127.0.0.1:3123:3000'],
    'published on 127.0.0.1 only'
  );
  assert.deepEqual(run.slice(-6), [
    'playwright',
    'run-server',
    '--host',
    '0.0.0.0',
    '--port',
    '3000',
  ]);
  const rec = JSON.parse(readFileSync(browserFile(root), 'utf8'));
  assert.deepEqual(
    [rec.ws, rec.image, rec.digest, rec.playwright, rec.revision, rec.container, rec.port],
    ['ws://127.0.0.1:3123/', image, 'sha256:feed', '1.58.2', 'abc123', 'c0ffee', 3123]
  );

  const again = await browserCommand({
    sub: 'start',
    flags: { image, port: '3123' },
    root,
    docker: d.docker,
  });
  assert.equal(again.data.started, false, 'already running: started once');
  await assert.rejects(
    browserCommand({
      sub: 'start',
      flags: { image: `${image}-r2`, port: '3123' },
      root,
      docker: d.docker,
    }),
    /already running .*browser stop/
  );

  const st = await browserCommand({ sub: 'status', root, docker: d.docker });
  assert.equal(st.data.running, true);

  const stop = await browserCommand({ sub: 'stop', root, docker: d.docker });
  assert.equal(stop.data.stopped, true);
  assert.ok(!existsSync(browserFile(root)), 'record removed');
});

test('pxsig browser: no docker CLI, or no daemon, is a setup error (exit 2); bad usage too', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-ws-'));
  await assert.rejects(
    browserCommand({
      sub: 'start',
      flags: { image: 'x:0.5.0-pw1.58.2' },
      root,
      docker: fakeDocker({ missing: true }).docker,
    }),
    (/** @type {Error & { exit?: number }} */ e) =>
      e.exit === 2 && /docker CLI is not installed/.test(e.message)
  );
  await assert.rejects(
    browserCommand({
      sub: 'start',
      flags: { image: 'x:0.5.0-pw1.58.2' },
      root,
      docker: fakeDocker({ daemon: false }).docker,
    }),
    (/** @type {Error & { exit?: number }} */ e) =>
      e.exit === 2 && /daemon is not answering/.test(e.message)
  );
  await assert.rejects(
    browserCommand({
      sub: 'start',
      flags: { port: 'abc', image: 'x' },
      root,
      docker: fakeDocker().docker,
    }),
    (/** @type {Error & { exit?: number }} */ e) => e.exit === 2 && /--port/.test(e.message)
  );
  await assert.rejects(
    browserCommand({ sub: 'nope', root }),
    (/** @type {Error & { exit?: number }} */ e) => e.exit === 2 && /usage/.test(e.message)
  );
  await assert.rejects(
    browserCommand({
      sub: 'start',
      flags: { image: 'x:0.5.0-pw1.58.2' },
      root,
      docker: fakeDocker({ ready: false }).docker,
      waitMs: 50,
    }),
    (/** @type {Error & { exit?: number }} */ e) => e.exit === 2 && /did not start/.test(e.message)
  );
  // A record, and docker gone: status and stop say so (exit 2).
  mkdirSync(dirname(browserFile(root)), { recursive: true });
  writeFileSync(
    browserFile(root),
    JSON.stringify({ ws: 'ws://127.0.0.1:3000/', image: 'x', container: 'c' })
  );
  await assert.rejects(
    browserCommand({ sub: 'status', root, docker: fakeDocker({ missing: true }).docker }),
    (/** @type {Error & { exit?: number }} */ e) => e.exit === 2
  );
});

test('pxsig browser from the CLI, with no docker on PATH: status exits 0, start exits 2', () => {
  const f = fixture({ withSigs: false });
  // No PATH entry holds docker (Windows spells the variable Path: drop every spelling).
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH')
  );
  Object.assign(env, {
    PATH: join(f.repo, 'no-such-bin'),
    PXSIG_NO_DELEGATE: '1',
    PXSIG_FORMAT: 'plain',
    PXSIG_WORKSPACE: '',
  });
  const status = spawnSync(process.execPath, [cli, 'browser', 'status'], {
    cwd: f.repo,
    env,
    encoding: 'utf8',
  });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /none recorded/);
  const start = spawnSync(
    process.execPath,
    [cli, 'browser', 'start', '--image', 'ghcr.io/hydrotik/pxsig:0.5.0-pw1.58.2'],
    { cwd: f.repo, env, encoding: 'utf8' }
  );
  assert.equal(start.status, 2);
  assert.match(start.stderr, /docker CLI is not installed/);
});

test('the default image is this pxsig with the project’s Playwright', () => {
  assert.equal(defaultImage('1.58.2'), `ghcr.io/hydrotik/pxsig:${PXSIG_VERSION}-pw1.58.2`);
  assert.equal(defaultImage(null), null);
});

test('image-mismatch: inside the image, a Playwright or a pxsig other than the project pins', () => {
  assert.deepEqual(parseImageTag('ghcr.io/hydrotik/pxsig:0.5.0-pw1.58.2-r2-amd64@sha256:aa'), {
    pxsig: '0.5.0',
    playwright: '1.58.2',
  });
  assert.equal(parseImageTag('ghcr.io/hydrotik/pxsig'), null);
  const ws = mkdtempSync(join(tmpdir(), 'pxsig-ws-'));
  mkdirSync(join(ws, 'node_modules', 'pxsig'), { recursive: true });
  writeFileSync(
    join(ws, 'node_modules', 'pxsig', 'package.json'),
    JSON.stringify({ name: 'pxsig', version: '0.5.0' })
  );
  const pw = fakePlaywright('1.58.2');
  const P = { root: ws, workspaceRoot: ws };
  assert.deepEqual(imageProblems(P, ws, {}), [], 'not in the image: nothing');
  assert.deepEqual(
    imageProblems(P, ws, {
      PXSIG_IMAGE: 'ghcr.io/hydrotik/pxsig:0.5.0-pw1.58.2',
      PXSIG_PLAYWRIGHT: pw,
    }),
    [],
    'matching'
  );
  const off = imageProblems(P, ws, {
    PXSIG_IMAGE: 'ghcr.io/hydrotik/pxsig:0.5.1-pw1.59.0',
    PXSIG_PLAYWRIGHT: pw,
  });
  assert.deepEqual(
    off.map((x) => [x.code, x.severity]),
    [
      ['image-mismatch', 'warn'],
      ['image-mismatch', 'warn'],
    ]
  );
  assert.match(
    off[0].reason,
    /built for Playwright 1\.59\.0, but Playwright 1\.58\.2 resolves here/
  );
  assert.match(off[1].reason, /runs pxsig 0\.5\.1, but this project pins pxsig 0\.5\.0/);
});
