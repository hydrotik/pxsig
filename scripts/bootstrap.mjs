#!/usr/bin/env node
/**
 * bootstrap.mjs — a contributor's setup, as CONTRIBUTING.md "Setup" describes it, in one command.
 *
 *   node scripts/bootstrap.mjs           check each step, and run the ones that are missing
 *   node scripts/bootstrap.mjs --check   check only: changes nothing; exit 1 names what is missing
 *
 * Steps, in order:
 *   node       the running Node is at least `.nvmrc`'s version (checked, never installed)
 *   pnpm       pnpm runs, at the major `packageManager` pins (checked; `corepack enable` sets it up)
 *   install    node_modules matches pnpm-lock.yaml; else `pnpm install --frozen-lockfile`
 *   rust       rustc is `rust-toolchain.toml`'s channel; else `rustup toolchain install`
 *   engine     target/release/pxsig is newer than the Rust sources; else `cargo build --release
 *              --locked`
 *   chromium   Playwright's Chromium is on disk (a file check; no browser starts); else
 *              `pnpm --filter pxsig exec playwright install chromium`
 *
 * Every program starts without a shell: on Windows pnpm runs only as `pnpm.exe`, or through Node
 * when this script runs under pnpm (`npm_execpath`); a `.cmd` shim needs cmd.exe, so the step is
 * reported instead. Exit: 0 everything is in place · 1 a step is missing or failed · 2 usage.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * `major.minor.patch` of a version string (`v22.18.0`, `22.18`, `rustc 1.99.0 (…)`), or null.
 * @param {string | null | undefined} text
 * @returns {[number, number, number] | null}
 */
export function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/**
 * Whether `have` is at least `want`.
 * @param {[number, number, number]} have
 * @param {[number, number, number]} want
 */
export function atLeast(have, want) {
  for (let i = 0; i < 3; i++) if (have[i] !== want[i]) return have[i] > want[i];
  return true;
}

/**
 * The pins a checkout declares: `.nvmrc`, `packageManager` and `rust-toolchain.toml`'s channel.
 * @param {string} dir
 * @returns {{ node: string | null, pnpm: string | null, rust: string | null }}
 */
export function pins(dir) {
  /** @param {string} f */
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  const pkg = /** @type {{ packageManager?: string }} */ (JSON.parse(read('package.json') || '{}'));
  return {
    node: read('.nvmrc').trim() || null,
    pnpm: /^pnpm@(.+)$/.exec(pkg.packageManager ?? '')?.[1] ?? null,
    rust: /^\s*channel\s*=\s*"([^"]+)"/m.exec(read('rust-toolchain.toml'))?.[1] ?? null,
  };
}

/**
 * A program on PATH that starts without a shell: `name` (POSIX) or `name.exe` (Windows), or null.
 * @param {string} name
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string }} [opts]
 * @returns {string | null}
 */
export function onPath(name, { env = process.env, platform = process.platform } = {}) {
  const file = platform === 'win32' ? `${name}.exe` : name;
  const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter);
  for (const d of dirs) if (d && existsSync(join(d, file))) return join(d, file);
  return null;
}

/**
 * How to start pnpm without a shell: its JS entry through this Node when pnpm runs this script,
 * else the program on PATH; null when there is none.
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string }} [opts]
 * @returns {string[] | null}
 */
export function pnpmCommand({ env = process.env, platform = process.platform } = {}) {
  const ep = env.npm_execpath;
  if (ep && /pnpm(\.c?js)?$/i.test(ep.split(/[\\/]/).pop() ?? '')) return [process.execPath, ep];
  const bin = onPath('pnpm', { env, platform });
  return bin ? [bin] : null;
}

/**
 * The newest modification time under `paths` (files, or folders walked; `target` is skipped).
 * @param {string[]} paths
 * @returns {number}
 */
export function newest(paths) {
  let t = 0;
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const s = statSync(p);
    if (!s.isDirectory()) t = Math.max(t, s.mtimeMs);
    else
      for (const e of readdirSync(p))
        if (e !== 'target' && !e.startsWith('.')) t = Math.max(t, newest([join(p, e)]));
  }
  return t;
}

/**
 * Run a program, no shell, output to this terminal; true when it exits 0.
 * @param {string[]} cmd
 * @param {NodeJS.ProcessEnv} [env]
 */
function run(cmd, env = process.env) {
  console.log(`[bootstrap]   running: ${cmd.map((a) => a.split(/[\\/]/).pop()).join(' ')}`);
  return spawnSync(cmd[0], cmd.slice(1), { cwd: root, stdio: 'inherit', env }).status === 0;
}

/**
 * A program's first line of `--version`, or null when it does not start.
 * @param {string[]} cmd
 * @param {NodeJS.ProcessEnv} [env]
 */
function version(cmd, env = process.env) {
  const r = spawnSync(cmd[0], [...cmd.slice(1), '--version'], { cwd: root, encoding: 'utf8', env });
  return r.status === 0 ? r.stdout.trim().split('\n')[0] : null;
}

/**
 * A step: `check` returns `{ ok, detail }`; `fix` (absent for what this script cannot install)
 * runs the documented command and returns whether it exited 0.
 * @typedef {{ ok: boolean, detail: string }} StepResult
 * @typedef {{ name: string, check: () => StepResult | Promise<StepResult>,
 *   fix?: () => boolean }} Step
 */

/** @returns {Step[]} */
function steps() {
  const pin = pins(root);
  const pnpm = () => pnpmCommand();
  // In --check rustup must not install a missing toolchain on first use.
  const noInstall = { ...process.env, RUSTUP_AUTO_INSTALL: '0' };
  const exe = process.platform === 'win32' ? 'pxsig.exe' : 'pxsig';
  return [
    {
      name: 'node',
      check: () => {
        const want = parseVersion(pin.node);
        const have = /** @type {[number, number, number]} */ (parseVersion(process.version));
        return want && !atLeast(have, want)
          ? { ok: false, detail: `${process.version}; .nvmrc needs ${pin.node} (nvm use)` }
          : { ok: true, detail: `${process.version} (.nvmrc ${pin.node ?? 'unset'})` };
      },
    },
    {
      name: 'pnpm',
      check: () => {
        const cmd = pnpm();
        const v = cmd && version(cmd);
        if (!v)
          return {
            ok: false,
            detail: `no pnpm that starts without a shell; corepack enable (package.json pins ${pin.pnpm})`,
          };
        const same = parseVersion(v)?.[0] === parseVersion(pin.pnpm)?.[0];
        return same
          ? { ok: true, detail: `${v} (package.json pins ${pin.pnpm})` }
          : { ok: false, detail: `${v}; package.json pins ${pin.pnpm} (corepack enable)` };
      },
    },
    {
      name: 'install',
      check: () => {
        const copy = join(root, 'node_modules', '.pnpm', 'lock.yaml');
        const lock = join(root, 'pnpm-lock.yaml');
        const ok = existsSync(copy) && readFileSync(copy, 'utf8') === readFileSync(lock, 'utf8');
        return {
          ok,
          detail: ok ? 'node_modules matches pnpm-lock.yaml' : 'node_modules missing or stale',
        };
      },
      fix: () => {
        const cmd = pnpm();
        return !!cmd && run([...cmd, 'install', '--frozen-lockfile']);
      },
    },
    {
      name: 'rust',
      check: () => {
        const v = onPath('rustc') ? version(['rustc'], noInstall) : null;
        const ok = !!v && v.split(' ')[1] === pin.rust;
        return {
          ok,
          detail: v
            ? `${v} (rust-toolchain.toml ${pin.rust})`
            : `no rustc; rust-toolchain.toml pins ${pin.rust}`,
        };
      },
      fix: () => !!onPath('rustup') && run(['rustup', 'toolchain', 'install']),
    },
    {
      name: 'engine',
      check: () => {
        const bin = join(root, 'target', 'release', exe);
        if (!existsSync(bin)) return { ok: false, detail: `no target/release/${exe}` };
        const src = newest(['Cargo.toml', 'Cargo.lock', 'crates'].map((p) => join(root, p)));
        const ok = statSync(bin).mtimeMs >= src;
        return {
          ok,
          detail: ok ? `target/release/${exe}` : `target/release/${exe} is older than crates/`,
        };
      },
      fix: () => !!onPath('cargo') && run(['cargo', 'build', '--release', '--locked']),
    },
    {
      name: 'chromium',
      check: async () => {
        let path;
        try {
          const req = createRequire(join(root, 'packages', 'pxsig', 'package.json'));
          // Playwright is CommonJS: its exports arrive on `default`.
          const pw = /** @type {{ default: { chromium: { executablePath(): string } } }} */ (
            await import(pathToFileURL(req.resolve('playwright')).href)
          );
          path = pw.default.chromium.executablePath();
        } catch {
          return { ok: false, detail: 'playwright is not installed (the install step first)' };
        }
        const ok = existsSync(path);
        const linux =
          process.platform === 'linux' ? '; on Linux add --with-deps the first time' : '';
        return {
          ok,
          detail: ok ? "Playwright's Chromium is installed" : `no Chromium at ${path}${linux}`,
        };
      },
      fix: () => {
        const cmd = pnpm();
        return (
          !!cmd && run([...cmd, '--filter', 'pxsig', 'exec', 'playwright', 'install', 'chromium'])
        );
      },
    },
  ];
}

/** @param {string[]} args */
async function main(args) {
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length) {
    console.error(`usage: node scripts/bootstrap.mjs [--check] (unknown: ${unknown.join(' ')})`);
    process.exit(2);
  }
  const checkOnly = args.includes('--check');
  /** @type {string[]} */
  const missing = [];
  for (const s of steps()) {
    let r = await s.check();
    console.log(`[bootstrap] ${s.name.padEnd(8)} ${r.ok ? 'ok' : 'missing'} · ${r.detail}`);
    if (!r.ok && !checkOnly && s.fix) {
      r = s.fix() ? await s.check() : r;
      console.log(`[bootstrap] ${s.name.padEnd(8)} ${r.ok ? 'ok' : 'failed'} · ${r.detail}`);
    }
    if (!r.ok) missing.push(s.name);
  }
  if (missing.length) {
    console.error(
      `[bootstrap] ${checkOnly ? 'missing' : 'not set up'}: ${missing.join(', ')} (CONTRIBUTING.md, "Setup")`
    );
    process.exit(1);
  }
  console.log('[bootstrap] ok · every step is in place');
}

// Imported (by its test) for the pure functions: run nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main(process.argv.slice(2));
