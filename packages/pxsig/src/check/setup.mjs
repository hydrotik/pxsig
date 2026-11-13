/**
 * check/setup.mjs — `pxsig check` before it selects anything: the flags, the project and its run
 * manifest, the refusals that need no Storybook (`--kind`, `--update` without a person, a
 * conflicted store, a missing engine), the gates this run enforces, and `rust()`, the engine call
 * every stage uses. Prints the run's first line.
 */
import { spawnSync } from '../lib/spawn.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import { conflictedStoreFiles } from '../lib/approvals.mjs';
import { parseArgs, strFlag } from '../lib/args.mjs';
import { humanAtTerminal, whyNotPerson } from '../lib/term.mjs';
import { flagLayer, openProject, writeRunManifest } from '../lib/workspace.mjs';
import { relPath } from '../lib/paths.mjs';
import { herePath } from '../lib/machine.mjs';
import { leadLine, resolveOrExit } from '../lib/enforcement.mjs';
/** @import { Project } from '../types.js' */

/** @typedef {(m: string, code?: number) => never} Die */
/** @typedef {ReturnType<typeof openCheck>} CheckSetup */

/** @param {string[]} argv the arguments after `check` */
export function openCheck(argv) {
  const { flags } = parseArgs(argv);
  const str = (/** @type {string} */ k) => strFlag(flags, k);
  /** @type {(m: string, code?: number) => never} */
  const die = (m, code = 2) => (console.error(`[check] ${m}`), process.exit(code));
  /** @type {Project} */
  let P;
  try {
    P = openProject({
      workspace: str('workspace'),
      project: str('project'),
      flags: flagLayer(flags),
    });
  } catch (e) {
    // openProject throws an Error (a SetupError) that says what is wrong.
    die(/** @type {Error} */ (e).message);
  }
  const rustBin = P.rustBin;
  const reports = P.store.reports;
  const concurrency = Number(flags.concurrency) || 8;
  const retries = flags.retries === undefined ? 2 : Number(flags.retries);
  const suite = str('suite');
  const manifestPath = P.manifestPath(suite);
  let run;
  try {
    run = writeRunManifest(P, manifestPath);
  } catch (e) {
    // writeRunManifest throws an Error that says what is wrong.
    die(/** @type {Error} */ (e).message);
  }
  const runPath = run.path;
  const manifest = run.manifest;
  const pngDir = P.store.latest;
  const diffDir = P.store.diffLatest;
  const a11yBaselinePath = P.store.a11y;
  const rel = (/** @type {string} */ p) => relPath(P.workspaceRoot, p);
  // A suite run keeps its own report, so the main report stays intact.
  const outName = str('out') ?? (suite ? `check-${suite}` : 'check');
  // --kind (with --update) is written on every log line, --reason kept beside each line's ref in
  // the git-ignored reports/ (lib/decisions.mjs): `--kind environment` re-takes baselines for a
  // new render environment and leaves the accepted a11y list as it is.
  const kind = str('kind');
  if (kind != null && !/^[a-z][a-z0-9-]{0,15}$/.test(kind))
    die(
      `--kind takes a short lower-case word (up to 16 characters, e.g. environment); got "${kind}"`
    );
  if ((kind != null || str('reason') != null || flags['allow-masks'] != null) && !flags.update)
    die('--kind, --reason and --allow-masks go with --update');
  if (flags.update && !humanAtTerminal())
    die(
      `--update writes baselines without review: run it yourself in a terminal (${whyNotPerson()})`,
      3
    );
  // A merge or rebase that left store files conflicted: checking against one side of
  // a half-merged baseline would mislead, so stop and say how to finish (docs/ci.md, "Rebasing with baselines").
  const conflicted = conflictedStoreFiles(P);
  if (conflicted.length)
    die(
      `${conflicted.length} store files are conflicted (a merge or rebase is not finished): ${conflicted.slice(0, 5).join(', ')}${conflicted.length > 5 ? ', …' : ''}. Take main's version of each baseline (\`git checkout --ours <file>\` during a rebase, \`--theirs\` during a merge), keep both sides' lines of a log, then \`pxsig check --since main\` and approve what changed again (docs/ci.md, "Rebasing with baselines").`
    );
  // Warn mode: which gates this run enforces (only committed config, or a person's --warn, lowers one).
  const enf = flags.update
    ? null
    : resolveOrExit(P, { flags }, (m) => console.error(`[check] ${m}`));
  const lead = enf && leadLine(enf);
  if (lead) console.log(`[pxsig] ${lead}`);
  if (!existsSync(rustBin))
    die(
      `the pxsig binary is missing (${herePath(rustBin)}): install the platform package, or build it with \`cargo build --release\``
    );
  mkdirSync(reports, { recursive: true });

  /**
   * `partial`: exit 2 with a JSON answer is some entries failing (`baseline`), not the command.
   * @param {string[]} args
   * @param {{ allowFail?: boolean, partial?: boolean }} [opts]
   */
  const rust = (args, { allowFail = true, partial = false } = {}) => {
    const t = performance.now();
    const r = spawnSync(rustBin, args, {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      cwd: P.workspaceRoot,
    });
    const answered = partial && r.stdout.trimStart().startsWith('{');
    if ((r.status === 2 && !answered) || (!allowFail && r.status !== 0))
      die(`pxsig ${args[0]} failed: ${r.stderr || r.stdout}`);
    return { out: r.stdout, ms: performance.now() - t, status: r.status };
  };
  console.log(
    `[check] project ${P.name}${suite ? ` · suite ${suite}` : ''} · ${manifest.stories.length} entries · store ${rel(P.store.root)}`
  );
  return {
    flags,
    str,
    die,
    P,
    reports,
    concurrency,
    retries,
    suite,
    manifestPath,
    runPath,
    manifest,
    pngDir,
    diffDir,
    a11yBaselinePath,
    rel,
    outName,
    kind,
    enf,
    rust,
  };
}
