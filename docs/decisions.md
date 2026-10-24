# Design decisions

Each decision with the reason for it and what it costs.

## Gate on signatures, not on full-resolution pixels

**Decision.** The gate compares compact `grid x grid` RGB signatures (64 x 64 by default) with SSIM
as the main metric, backed by changed cells, colour delta, edge maps and perceptual hashes.

**Why.** Full-resolution pixel comparison fails on noise that nobody can see: anti-aliasing, font
hinting, sub-pixel layout. Averaging into cells removes that noise and keeps layout and colour.
SSIM catches structural change; the other metrics localise it and catch what SSIM smooths over.

**Cost.** A coarse grid can average away a thin change. The detail channel (sparse, full-resolution
tiles with edge energy) covers borders, strokes and icons; the adaptive grid keeps cells near
`minCellPx` on small components.

## Pack the baseline image with its signature

**Decision.** One `.psig` file per entry holds the signature and the full baseline image.

**Why.** A reviewer needs to see the baseline, and a signature alone cannot show it. Two files per
entry drift apart: one gets deleted, renamed or left behind. One file cannot. The raw signature
bytes are also smaller than the base64 JSON form, and every section carries a sha256.

**Cost.** Stores are larger than signature-only stores. The image is still only used for display
and review; the gate reads the signature.

## Stores live with the project under test

**Decision.** Each project keeps its store in its own folder (`.pxsig/` by default). The tool's
install holds no state.

**Why.** Baselines belong to the code they describe: they move, branch and get reviewed with it.
A tool folder that also holds state only works in the one repository it sits in.

## A committed registry, not a scan

**Decision.** A monorepo lists its projects in `pxsig.workspace.json`.

**Why.** A scan cannot tell a project that was never set up from one whose config was deleted. A
committed list makes adding or dropping a project a reviewed change, and lets every surface agree
on the same set.

## One install per repository

**Decision.** One root install serves every project. A nested install hands over to the root one.

**Why.** Signatures and gate results must come from one engine version. Two installs in one
repository could write baselines the other reads differently.

## Config in layers

**Decision.** Story parameters, then CLI flags, environment, project config, workspace defaults,
built-in defaults. Objects merge; modes replace.

**Why.** Shared settings belong once in the workspace file; a project overrides what differs; a
story overrides what only it needs. Modes are a set, so merging two sets would produce modes
nobody declared.

## A Rust engine

**Decision.** Signatures, metrics, the gate and batch checks run in Rust (`pxsig-core`,
`pxsig-cli`). Orchestration stays in Node.

**Why.** The engine is CPU-bound and runs over thousands of renders; Rust runs it in parallel on
every core with no garbage collector in the way. The browser side (Playwright, Storybook) lives in
Node, where those tools live.

## Render with Playwright, deterministically

**Decision.** Fixed viewport at device scale 1, reduced motion, a stylesheet that freezes
animations and hides carets, a fixed `Math.random`, fonts awaited, then a wait until the layout
stops moving.

**Why.** A pixel gate is only as good as its renders. Animation, carets, random data and late fonts
are the usual sources of false failures. Waiting for layout stability instead of a fixed delay
handles components that measure themselves.

## The doctor never writes signatures or approves

**Decision.** Integrity reports gaps and repairs only what it can prove: registering a story
without a signature, re-checking, and restoring a missing image only from a render that passes the
existing signature's gate. Pruning moves files and needs a person.

**Why.** A repair that could change a baseline would be an approval nobody made. Tools that fix
coverage must not be able to hide a regression.

## Approvals are logged and reversible

**Decision.** Every approval, from any surface, snapshots the old baseline and logs who, when, how,
why, and the hashes before and after. Bulk approval classifies colour versus shape changes, pins
render hashes, and needs a person at a terminal. Agents cannot approve: the server takes
approvals only from the dashboard and `pxsig approve apply`, and the MCP server can only reject.

**Why.** A baseline change is the one thing pxsig must never do silently. A log with hashes makes
an unlogged change detectable (`approve verify`), and a snapshot makes a mistaken approval cheap
to undo.

## Encryption is reserved, not built

**Decision.** The `.psig` header carries `encryption: "none"`, and readers refuse anything else.

**Why.** Some teams may want baselines of unreleased UI unreadable without a key. Reserving the
field now means adding it later is not a format break. Nothing about it is implemented.

## Research tools live in the repository, not the package

**Decision.** The scripts that measure pxsig on a project (simulated regressions, gate and detail
calibration, benchmarks) live in [`tools/`](../tools/README.md) in this repository and are not part
of the npm package. They drive the same Rust binary and write JSON into the project's
`<store>/reports/`; the dashboard shows the Scenarios, Calibration and Performance tabs only when
those reports exist.

**Why.** They are for people tuning pxsig, not for every install, and their interface may still
change. The gate defaults they produced ship as the built-in config.

## One writer per store

**Decision.** Every command that writes a store takes `<store>/reports/.lock`; the server holds it
for every project it serves, and a full check against a served project goes through the server's
queue.

**Why.** Two writers (a full check and a dashboard approval, two checks in two terminals) would
interleave renders and reports, and an approval could land on a render another process was
rewriting. A pid-and-start-time lock is enough on one machine, needs no daemon, and clears itself
when its process is gone.

## A story's gate beats run-wide settings

**Decision.** Gate values resolve as defaults < project config < `PXSIG_*` environment < CLI flags
< the story's `parameters.pxsig.gate`.

**Why.** A story gate is a judgement written next to the one story it is about; a variable or a flag
is a blunt instrument for a whole run. Letting the run-wide value win would silently loosen (or
tighten) every story someone had tuned.
