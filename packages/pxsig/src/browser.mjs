/**
 * browser.mjs — `pxsig browser start|stop|status`: Playwright's browser in the pxsig container image,
 * for this machine's checks and dashboard (docs/container.md, mode (ii)).
 *
 *   pxsig browser start [--image tag] [--port 3000]
 *   pxsig browser stop
 *   pxsig browser status
 *
 * `start` runs `playwright run-server` in the image, published on 127.0.0.1 only, and records the
 * endpoint, the image and its digest in node_modules/.cache/pxsig/browser.json. Checks and
 * `pxsig serve` then render there with `--browser <ws>` (or PXSIG_BROWSER_WS, or
 * capture.browserEndpoint); Storybook and the engine stay on this machine. These three commands are
 * the only ones that start `docker` (docs/platforms.md); without the docker CLI they stop with a
 * setup error (exit 2) and nothing else in pxsig changes.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from './lib/spawn.mjs';
import { browserFile, PXSIG_VERSION, resolvePeer } from './lib/workspace.mjs';

export const IMAGE_REPO = 'ghcr.io/hydrotik/pxsig';
const SUBS = ['start', 'stop', 'status'];

const setupError = (m) => Object.assign(new Error(m), { exit: 2 });

/** `docker <args>` through lib/spawn.mjs: `{ status, stdout, stderr, missing }`. */
export function dockerRunner(args, opts = {}) {
  const r = spawnSync('docker', args, { encoding: 'utf8', ...opts });
  return { status: r.status, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), missing: r.error?.code === 'ENOENT', error: r.error ?? null };
}

/** The docker CLI answers and its daemon runs, else a setup error naming which is missing. */
function needDocker(docker) {
  const r = docker(['version', '--format', '{{.Server.Version}}']);
  if (r.missing) throw setupError('the docker CLI is not installed (or not on PATH): `pxsig browser` runs the browser in the pxsig container image (docs/container.md). Without it, checks render with the browser on this machine, as before');
  if (r.error) throw setupError(`docker could not start: ${r.error.message}`);
  if (r.status !== 0) throw setupError(`docker is installed but its daemon is not answering (${(r.stderr.trim().split('\n')[0] || 'no server')}): start Docker, then run this again`);
}

const mm = (v) => String(v ?? '').split('.').slice(0, 2).join('.');

/** The Playwright version this project resolves, or null. */
export function projectPlaywright(P) {
  if (!P) return null;
  try {
    return JSON.parse(readFileSync(resolvePeer(P, 'playwright/package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/** The image for this pxsig and the project's Playwright: `ghcr.io/hydrotik/pxsig:<pxsig>-pw<playwright>`. */
export const defaultImage = (playwright) => (playwright ? `${IMAGE_REPO}:${PXSIG_VERSION}-pw${playwright}` : null);

export function readRecord(root) {
  const f = browserFile(root);
  try {
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  } catch {
    return null;
  }
}

/** Is the recorded container running? (false when docker does not know it.) */
function running(docker, rec) {
  const r = docker(['inspect', '--format', '{{.State.Running}}', rec.container]);
  if (r.status !== 0) return false;
  return r.stdout.trim() === 'true';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the subcommand. `root`: the workspace root (browser.json lives there). `P`: the project, for
 * its Playwright version (optional). Returns `{ blocks, data, exit }`; throws `{ exit: 2 }` errors.
 */
export async function browserCommand({ sub = 'status', flags = {}, root, P = null, docker = dockerRunner, waitMs = 60_000, CMD = 'pxsig' }) {
  if (!SUBS.includes(sub)) throw setupError(`usage: browser start [--image tag] [--port 3000] | stop | status (got "${sub}")`);
  if (!root) throw setupError('no workspace here: run it inside the repository (pxsig.workspace.json or pxsig.config.json)');
  const rec = readRecord(root);
  const pw = projectPlaywright(P);

  if (sub === 'status') {
    if (!rec) return { blocks: [{ h: 'Browser', sub: 'none recorded' }, { note: 'Checks launch the browser on this machine.' }, { next: [[`${CMD} browser start`, 'run it in the pxsig container image']] }], data: { running: false, record: null }, exit: 0 };
    needDocker(docker);
    const up = running(docker, rec);
    const blocks = [{ h: 'Browser', sub: up ? 'running' : 'stopped' }, { kv: [['Endpoint', rec.ws], ['Image', rec.image], ['Digest', rec.digest ?? 'unknown'], ['Playwright', rec.playwright ?? 'unknown'], ['Container', rec.name ?? rec.container]] }];
    if (pw && rec.playwright && mm(pw) !== mm(rec.playwright)) blocks.push({ note: `This project resolves Playwright ${pw}; the image has ${rec.playwright}. Playwright refuses a server on another major.minor.`, tone: 'bad' });
    blocks.push({ next: up ? [[`${CMD} check --full --browser ${rec.ws}`, 'render there'], [`${CMD} browser stop`, 'stop it']] : [[`${CMD} browser start`, 'start it again']] });
    return { blocks, data: { running: up, record: rec, projectPlaywright: pw }, exit: 0 };
  }

  if (sub === 'stop') {
    if (!rec) return { blocks: [{ h: 'Browser', sub: 'none recorded' }, { note: 'Nothing to stop.' }], data: { stopped: false }, exit: 0 };
    needDocker(docker);
    const r = docker(['stop', rec.container]);
    rmSync(browserFile(root), { force: true });
    const gone = r.status === 0 || /no such container/i.test(r.stderr);
    return { blocks: [{ h: 'Browser', sub: gone ? 'stopped' : 'record removed' }, ...(gone ? [] : [{ note: `docker stop ${rec.container}: ${r.stderr.trim()}`, tone: 'warn' }])], data: { stopped: gone, record: rec }, exit: 0 };
  }

  // start
  const port = flags.port === undefined || flags.port === true ? 3000 : Number(flags.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw setupError(`--port must be a port number (got "${flags.port}")`);
  const image = typeof flags.image === 'string' && flags.image ? flags.image : defaultImage(pw);
  if (!image) throw setupError(`no Playwright resolves in this project, so the image tag is unknown: pass --image ${IMAGE_REPO}:<pxsig>-pw<playwright>`);
  needDocker(docker);
  if (rec && running(docker, rec)) {
    if (rec.image !== image || rec.port !== port) throw setupError(`a browser container is already running (${rec.image} on ${rec.ws}): \`${CMD} browser stop\` first`);
    return { blocks: [{ h: 'Browser', sub: 'already running' }, { kv: [['Endpoint', rec.ws], ['Image', rec.image]] }], data: { record: rec, started: false }, exit: 0 };
  }
  const name = `pxsig-browser-${port}`;
  // A container of that name left over (stopped, or from another checkout): remove it first.
  docker(['rm', '-f', name]);
  const run = docker(['run', '-d', '--rm', '--init', '--name', name, '--label', 'io.pxsig.browser=1', '-p', `127.0.0.1:${port}:3000`, image, 'playwright', 'run-server', '--host', '0.0.0.0', '--port', '3000'], { stdio: ['ignore', 'pipe', 'inherit'] });
  if (run.status !== 0) throw setupError(`docker run ${image} failed${run.stderr.trim() ? `: ${run.stderr.trim().split('\n').pop()}` : ''}`);
  const container = run.stdout.trim().split('\n').pop();
  // Ready when the server says it listens.
  const until = Date.now() + waitMs;
  let ready = false;
  while (Date.now() < until) {
    const logs = docker(['logs', container]);
    if (/Listening on/i.test(logs.stdout + logs.stderr)) {
      ready = true;
      break;
    }
    if (!running(docker, { container })) break;
    await sleep(500);
  }
  if (!ready) {
    const logs = docker(['logs', container]);
    docker(['rm', '-f', container]);
    throw setupError(`the browser server in ${image} did not start${(logs.stdout + logs.stderr).trim() ? `: ${(logs.stdout + logs.stderr).trim().split('\n').pop()}` : ''}`);
  }
  const insp = docker(['image', 'inspect', '--format', '{{json .RepoDigests}}|{{json .Config.Labels}}', image]);
  let digest = null;
  let labels = {};
  try {
    const [d, l] = insp.stdout.trim().split('|');
    const digests = JSON.parse(d) ?? [];
    digest = (digests.find((x) => x.startsWith(`${image.split(':')[0].split('@')[0]}@`)) ?? digests[0] ?? '').split('@')[1] ?? null;
    labels = JSON.parse(l) ?? {};
  } catch {
    // a locally built image has no digest: recorded as unknown
  }
  const record = {
    ws: `ws://127.0.0.1:${port}/`,
    image,
    digest,
    revision: labels['org.opencontainers.image.revision'] ?? null,
    playwright: labels['io.pxsig.playwright'] ?? (image.match(/-pw(\d+\.\d+\.\d+)/) ?? [])[1] ?? null,
    pxsig: labels['io.pxsig.version'] ?? null,
    container,
    name,
    port,
    startedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(browserFile(root)), { recursive: true });
  writeFileSync(browserFile(root), JSON.stringify(record, null, 2) + '\n');
  const blocks = [{ h: 'Browser', sub: 'started' }, { kv: [['Endpoint', record.ws], ['Image', image], ['Digest', digest ?? 'unknown (a local image)'], ['Playwright', record.playwright ?? 'unknown']] }];
  if (pw && record.playwright && mm(pw) !== mm(record.playwright)) blocks.push({ note: `This project resolves Playwright ${pw}; the image has ${record.playwright}. Playwright refuses a server on another major.minor: use the image for ${pw}.`, tone: 'bad' });
  blocks.push({ next: [[`${CMD} check --full --browser ${record.ws}`, 'a full check rendered there'], [`PXSIG_BROWSER_WS=${record.ws} ${CMD} serve`, 'the dashboard re-checks there too'], [`${CMD} browser stop`, 'stop it']] });
  return { blocks, data: { record, started: true, projectPlaywright: pw }, exit: 0 };
}
