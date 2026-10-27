/**
 * args.mjs — one argv parser for every pxsig entry point (cli, check, serve, report).
 *
 * `--name value`, `--name=value`, and boolean flags, which never take the next word as a value.
 * Everything not starting with `--` is positional.
 */
export const BOOLEAN_FLAGS = new Set([
  'json', 'plain', 'pretty', 'markdown', 'help', 'all', 'new', 'adopt', 'all-changed', 'first-baselines',
  'ci', 'repair', 'apply', 'prune', 'offline', 'full', 'update', 'watch', 'no-open', 'no-verify', 'no-a11y',
  'no-server', 'from-git', 'strict-env', 'warn', 'enforce',
]);

export function parseArgs(argv, { booleans = BOOLEAN_FLAGS } = {}) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') || a === '--') {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const name = a.slice(2);
    flags[name] = !booleans.has(name) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return { positional, flags };
}

/** A flag's string value, or null (absent, or given without a value). */
export const strFlag = (flags, k) => (typeof flags[k] === 'string' && flags[k] !== '' ? flags[k] : null);
