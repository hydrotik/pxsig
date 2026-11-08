//! `pxsig` — native CLI over `pxsig-core`.
//!
//! `capture` / `compare` work on one PNG and one baseline (`.psig`, or a spec v1 `.pxsig.json`).
//! The batch and tooling commands:
//!
//! - `check` / `baseline` — batch over a manifest on a Rayon pool, with per-story
//!   gates and grids, the detail channel, a content cache and run history;
//! - `diff` — full-resolution pixel diff + change regions between two renders;
//! - `affected` — which entries a change can touch (import graph from git);
//! - `report` — Markdown (PR comment) / JUnit from a check result;
//! - `pack` / `cat` / `attach` — build `.psig` baselines from spec v1 records, print a header
//!   (git's textconv), add a baseline image without touching the signature;
//! - `react-plan` / `react-diff` — React analysis: what to compile, then base vs now per function;
//! - `serve` — the engine as a stdio JSON-RPC daemon;
//! - `detail-sweep` — raw material for calibrating the detail channel.
//!
//! Exit codes: 0 pass · 1 visual regression · 2 usage / IO / validation.

mod affected;
mod batch;
mod cmd_check;
mod cmd_store;
mod gate;
mod io;
mod react;
mod react_compile;
mod report;
mod report_react;
mod resolve;
mod serve;
mod sweep;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};

use crate::gate::GateArgs;
use cmd_check::{
    cmd_affected, cmd_baseline, cmd_capture, cmd_check, cmd_compare, cmd_diff, cmd_report,
    cmd_sweep, cmd_trim,
};
// `serve` calls `crate::diff_json`.
pub use cmd_check::diff_json;
use cmd_store::{cmd_attach, cmd_cat, cmd_pack};

#[derive(Parser)]
#[command(
    name = "pxsig",
    version,
    about = "Pixel-fingerprint visual regression (spec v1)"
)]
struct Cli {
    /// Rayon worker count for batch commands (default: logical CPUs).
    #[arg(short = 'j', long, global = true, env = "PXSIG_THREADS")]
    threads: Option<usize>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Write a baseline signature from one rendered PNG.
    Capture {
        png: PathBuf,
        #[arg(long)]
        out: Option<PathBuf>,
        #[arg(long, default_value_t = 64, env = "PXSIG_GRID")]
        grid: usize,
        /// Also store the detail channel (off by default: keeps the record plain spec v1).
        #[arg(long)]
        detail: bool,
    },
    /// Diff one rendered PNG against a committed signature.
    Compare {
        png: PathBuf,
        sig: PathBuf,
        #[arg(long)]
        out_dir: Option<PathBuf>,
        #[arg(long)]
        json: bool,
        #[command(flatten)]
        gate: GateArgs,
    },
    /// Batch diff: every manifest entry's `<png-dir>/<id>.png` against its baseline.
    Check {
        #[command(flatten)]
        batch: Box<BatchArgs>,
        #[arg(long)]
        out_dir: Option<PathBuf>,
        #[arg(long)]
        json: bool,
        /// human (default) · json · junit · markdown
        #[arg(long)]
        format: Option<String>,
        /// Skip the diff PNGs + html entirely (same as --artifacts none).
        #[arg(long)]
        no_artifacts: bool,
        /// Diff artifacts for: all · failed (default) · none.
        #[arg(long, default_value = "failed")]
        artifacts: String,
        /// Content cache directory: unchanged render + baseline + gate → reuse the result.
        #[arg(long)]
        cache: Option<PathBuf>,
        /// Append this run to an ndjson history file.
        #[arg(long)]
        history: Option<PathBuf>,
        /// Warn mode for the history line: `@file` (or inline JSON) `{ "gates": {…}, "a11yNew": n }`.
        #[arg(long)]
        enforcement: Option<String>,
        /// More keys for the history line: `@file` (or inline JSON), an object (`{ "react": {…} }`).
        #[arg(long)]
        history_extra: Option<String>,
        /// Base renders; failing entries also get a pixel diff with change regions.
        #[arg(long)]
        base_png_dir: Option<PathBuf>,
        #[arg(long, default_value_t = 16)]
        tolerance: u8,
        /// The environment each render was made in (as `baseline --env`; `byId` is read): a
        /// render's text record is compared only when it is its baseline's.
        #[arg(long)]
        env: Option<String>,
        #[command(flatten)]
        gate: GateArgs,
    },
    /// Batch capture: write a baseline for every manifest entry from `<png-dir>/<id>.png`.
    Baseline {
        #[command(flatten)]
        batch: BatchArgs,
        /// Leave the detail channel out of the records.
        #[arg(long)]
        no_detail: bool,
        /// The environment each render was made in, written into its `.psig` header as `env`:
        /// `@file` (or inline JSON) holding `{ "envs": { <envId>: env }, "byId": { <entryId>: <envId> } }`.
        #[arg(long)]
        env: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Pixel diff two renders: changed pixels, change regions, optional mask PNG.
    Diff {
        a: PathBuf,
        b: PathBuf,
        #[arg(long, default_value_t = 16)]
        tolerance: u8,
        #[arg(long)]
        mask: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// Entries a change can affect (import graph over the manifest's srcRoot).
    Affected {
        #[arg(long)]
        manifest: PathBuf,
        #[arg(long, env = "PXSIG_ROOT")]
        root: Option<PathBuf>,
        /// Git ref to diff against (merge-base with HEAD), plus uncommitted work.
        #[arg(long, default_value = "main")]
        since: String,
        /// Explicit changed files (workspace-relative, absolute or `$repo/…`, comma-separated) instead of git.
        #[arg(long)]
        files: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Render a check result as Markdown or JUnit.
    Report {
        #[arg(long)]
        input: PathBuf,
        /// markdown · junit
        #[arg(long, default_value = "markdown")]
        format: String,
        /// Dashboard URL; story names link to `<link-base>#inspect=<id>`.
        #[arg(long)]
        link_base: Option<String>,
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Crop renders to their content (right/bottom only, origin kept), in place.
    Trim {
        dir: PathBuf,
        #[arg(long)]
        only: Option<String>,
        #[arg(long, default_value_t = 16)]
        pad: usize,
        #[arg(long, default_value_t = 8)]
        tolerance: u8,
        #[arg(long)]
        json: bool,
    },
    /// Print a baseline's header (a `.psig` header, or a `.pxsig.json` without its signature
    /// bytes), then a `boxes` section's run strings, one a line; `--image` writes a `.psig`'s
    /// baseline image. Git's textconv for `*.psig`.
    Cat {
        file: PathBuf,
        #[arg(long)]
        image: Option<PathBuf>,
    },
    /// Pack spec v1 records (+ their images) into `.psig` files, byte for byte.
    /// `pack <sig.pxsig.json> --out x.psig [--image base.png] [--entry '{json}']`, or
    /// `pack --plan plan.json` with `[{ sig, out, image?, entry? }]` (parallel).
    Pack {
        sig: Option<PathBuf>,
        #[arg(long)]
        out: Option<PathBuf>,
        #[arg(long)]
        image: Option<PathBuf>,
        #[arg(long)]
        entry: Option<String>,
        #[arg(long)]
        plan: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// Add a baseline image to a `.psig` that has none. The record and signature bytes stay
    /// exactly as they were; a `.psig` that already has an image is refused (never overwritten).
    /// Callers prove the render passes the gate first (`doctor --repair` does).
    Attach {
        psig: PathBuf,
        png: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// React analysis, step 1: the changed module files to compile, each side's hash and cache hit.
    ReactPlan {
        #[arg(long)]
        manifest: PathBuf,
        #[arg(long, env = "PXSIG_ROOT")]
        root: Option<PathBuf>,
        /// Git ref to diff against (merge-base with HEAD), plus uncommitted work (default main).
        #[arg(long, conflicts_with_all = ["files", "all"])]
        since: Option<String>,
        /// Explicit changed files (comma-separated), compared with HEAD.
        #[arg(long, conflicts_with = "all")]
        files: Option<String>,
        /// Every module file that reaches an entry, with no comparison.
        #[arg(long)]
        all: bool,
        /// The cache directory (`<store>/cache/react`).
        #[arg(long)]
        cache: PathBuf,
        /// `@file` or inline JSON: `{ "key": { backend, compiler, babel, options }, "exclude"?: [globs] }`.
        #[arg(long)]
        options: String,
        /// Write the plan here and print only its counts.
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// React analysis, step 2: base vs now per function; writes the cache and `react.json`.
    ReactDiff {
        #[arg(long)]
        plan: PathBuf,
        /// `{ backend, project?, ms?, results: { <sha>: { functions } | { error } } }`.
        #[arg(long)]
        results: PathBuf,
        #[arg(long)]
        cache: PathBuf,
        #[arg(long)]
        out: PathBuf,
        /// Read the cache, write nothing to it (another process holds the store).
        #[arg(long)]
        read_only: bool,
    },
    /// The built-in React Compiler (`react-oxc` builds) over files: `{ options, files }` on stdin,
    /// `{ compiler, warnings, results }` on stdout, one result per file. Each batch runs in a child
    /// process; a file that crashes the compiler is `{ error: "compiler-error" }`.
    ReactCompile {
        /// The child process: compile and print one result per line.
        #[arg(long, hide = true)]
        worker: bool,
    },
    /// Long-lived engine: JSON requests on stdin, one JSON response per line.
    Serve,
    /// Detail-channel calibration data over base/current render pairs.
    DetailSweep {
        #[arg(long)]
        input: PathBuf,
    },
}

#[derive(Args)]
struct BatchArgs {
    /// Run manifest: the entries plus the resolved settings (`<store>/reports/.run/manifest.json`).
    #[arg(long)]
    manifest: PathBuf,
    /// Directory holding `<id>.png` renders.
    #[arg(long)]
    png_dir: PathBuf,
    /// Root that the manifest's `sig` paths are relative to (default: cwd).
    #[arg(long, env = "PXSIG_ROOT")]
    root: Option<PathBuf>,
    /// Only these entries: `a,b` or `@file` (lines or a JSON array).
    #[arg(long)]
    only: Option<String>,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    if let Some(n) = cli.threads {
        let _ = rayon::ThreadPoolBuilder::new()
            .num_threads(n)
            .build_global();
    }
    exit_code(run(cli.cmd))
}

/// One parsed command, run: its exit code, or the error `main` reports with exit code 2.
fn run(cmd: Cmd) -> anyhow::Result<u8> {
    match cmd {
        Cmd::Capture {
            png,
            out,
            grid,
            detail,
        } => cmd_capture(&png, out, grid, detail),
        Cmd::Compare {
            png,
            sig,
            out_dir,
            json,
            gate,
        } => cmd_compare(&png, &sig, out_dir, json, &gate),
        Cmd::Check {
            batch,
            out_dir,
            json,
            format,
            no_artifacts,
            artifacts,
            cache,
            history,
            enforcement,
            history_extra,
            base_png_dir,
            tolerance,
            env,
            gate,
        } => {
            let format =
                format.unwrap_or_else(|| if json { "json".into() } else { "human".into() });
            let artifacts = if no_artifacts {
                Ok(batch::Artifacts::None)
            } else {
                batch::Artifacts::parse(&artifacts)
            };
            artifacts.and_then(|a| {
                cmd_check(
                    *batch,
                    out_dir,
                    &format,
                    a,
                    cache,
                    history,
                    enforcement,
                    history_extra,
                    base_png_dir,
                    tolerance,
                    env,
                    &gate,
                )
            })
        }
        Cmd::Trim {
            dir,
            only,
            pad,
            tolerance,
            json,
        } => cmd_trim(&dir, only.as_deref(), pad, tolerance, json),
        Cmd::Baseline {
            batch,
            no_detail,
            env,
            json,
        } => cmd_baseline(batch, no_detail, env, json),
        Cmd::Diff {
            a,
            b,
            tolerance,
            mask,
            json,
        } => cmd_diff(&a, &b, tolerance, mask, json),
        Cmd::Affected {
            manifest,
            root,
            since,
            files,
            json,
        } => cmd_affected(&manifest, root, &since, files, json),
        Cmd::Report {
            input,
            format,
            link_base,
            out,
        } => cmd_report(&input, &format, link_base.as_deref(), out),
        Cmd::Cat { file, image } => cmd_cat(&file, image),
        Cmd::Pack {
            sig,
            out,
            image,
            entry,
            plan,
            json,
        } => cmd_pack(sig, out, image, entry, plan, json),
        Cmd::Attach { psig, png, json } => cmd_attach(&psig, &png, json),
        Cmd::ReactPlan {
            manifest,
            root,
            since,
            files,
            all,
            cache,
            options,
            out,
        } => {
            let files = files.map(|f| f.split(',').map(String::from).collect());
            let o = react::PlanOpts {
                manifest,
                root: root.unwrap_or_else(|| PathBuf::from(".")),
                select: react::select(since, files, all)?,
                cache,
                options: react::json_arg(&options)?,
            };
            react::cmd_plan(&o, out)
        }
        Cmd::ReactDiff {
            plan,
            results,
            cache,
            out,
            read_only,
        } => react::cmd_diff(&plan, &results, &cache, &out, read_only),
        Cmd::ReactCompile { worker } => react_compile::run(worker),
        Cmd::Serve => serve::run(),
        Cmd::DetailSweep { input } => cmd_sweep(&input),
    }
}

fn exit_code(res: anyhow::Result<u8>) -> ExitCode {
    match res {
        Ok(code) => ExitCode::from(code),
        Err(e) => {
            eprintln!("[pxsig] {e:#}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
#[path = "main_tests.rs"]
mod tests;
