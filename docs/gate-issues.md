# Reporting a gate problem

The gate can get an entry wrong in two directions:

- **False positive:** it flagged the entry when nothing visible changed.
- **False negative:** it passed the entry when something visible changed.

Either is worth an issue on [hydrotik/pxsig](https://github.com/hydrotik/pxsig/issues/new/choose),
with the form "The gate got it wrong". pxsig prepares the report for one entry, from the dashboard,
the CLI or an assistant. It never posts anything: the person who reports looks at it, opens the
issue and posts it.

## First: re-render on this machine

The most common false positive is the machine, not the gate: a different browser version, fonts or
GPU between the baseline and the render. Before it offers a report, the dashboard re-renders the
entry on this machine and says whether it still fails the gate. It is a dry re-render: the
entry's render, its result and any decision on it stay as they are. When it passes there, the earlier
difference most likely came from the environment: `pxsig doctor` names an environment mismatch
(`env-mismatch`, [configuration.md](configuration.md#env)), and rendering in pxsig's container
([container.md](container.md)) removes it.

From a terminal, `pxsig check <id>` re-renders the entry too, and records the result (which
clears a decision on the old one).

## What a report holds

The report has the shape of the issue form, one section per field:

| Section                        | What it holds                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| pxsig version and engine build | `pxsig 0.8.0 · engine 0.8.0`                                                                                                 |
| Entry and mode                 | `entry-1 · mode dark`: the story id is replaced with `entry-1` unless it is kept                                             |
| Gate settings                  | The gate the entry was checked with, as the engine resolved it ([spec.md](spec.md#gate-resolution)), the color rule included |
| Metrics                        | The verdict, the signature metrics, the color rule's and the detail channel's measurements, the pixel diff                   |
| Reasons                        | Every reason the gate gave; none when it passed                                                                              |
| Changed regions                | The pixel diff's boxes (x, y, width × height, changed pixels), the 20 largest                                                |
| Environment class              | OS family and architecture, browser and major version, GPU class, container or not: of the render and of the baseline        |
| Images                         | How the image was made, or that there is none                                                                                |

And **one image**: the baseline, the render and the diff side by side in a single PNG, cropped to
the changed regions with a 16 px margin and upscaled when small. A browser clipboard holds one image
at a time, and GitHub takes a pasted image, so one paste carries all three. **Full capture** takes
the whole image instead of the crop.

**Image-free** gives no image at all. Each changed region is listed with its average color in the
baseline and in the render, over its changed pixels: often enough to build a test case without
seeing the screen.

### What a report never holds

- Paths, user names or host names. The text is built from numbers, the gate's own reason lines and
  classes of environment; the workspace and home folders and the user name are also replaced if
  they appear in any value.
- The story id, unless **Keep story ID** (`--keep-id`, `keepId`) is chosen. Story ids often name
  unreleased features.
- Anything sent over the network. pxsig opens no connection to GitHub or anywhere else: the issue
  link opens in the person's browser, and the person posts.

## Before posting

An issue on hydrotik/pxsig is public. Anyone can see it, and it cannot be fully removed: it is
cached and indexed. Post images only when they show nothing confidential: no unreleased UI, no
customer data, no internal names. When in doubt, use the image-free report.

The form has a required checkbox: "These images contain nothing confidential, and I'm fine posting
them publicly."

Security problems never go in an issue: report them privately ([SECURITY.md](../SECURITY.md)).

## From the dashboard

In the inspector, **Report to pxsig** (beside Re-check) opens a dialog that:

1. re-renders the entry on this machine and says whether it still fails the gate;
2. shows exactly what will be copied: the image (or the image-free summary) and the text;
3. offers **Full capture**, **Keep story ID** and **Image-free**; the preview follows;
4. says the issue is public and cannot be fully removed.

**Copy text** and **Copy image** (one PNG; **Save image** where the browser's clipboard takes no
images) copy only when pressed. **Open issue** opens the issue form in a new tab with the text
fields filled in; the image is pasted there. **Cancel** closes the dialog; nothing was copied.

A page without the dashboard link (read only) can prepare a report too: it decides nothing. A
static report (`pxsig report --out …`) has no server, so no Report to pxsig.

## From the terminal

```bash
pxsig report components-button--primary              # text, image and the issue link
pxsig report components-button--primary --no-image   # regions and average colors, no image
pxsig report components-button--primary --full --keep-id
```

It writes `report.md` (the text, then the link), `report.json` (the facts) and `image.png` to the
store's git-ignored `reports/gate-report/<id>/`, and prints the link. `--json` prints the same as
data. Without an id, `pxsig report` is the static dashboard, as before ([cli.md](cli.md)).

## From an assistant

The MCP tool `pxsig_gate_report` prepares the same report and answers the text, the folder
(relative to the store) and the link ([mcp.md](mcp.md)). It never posts. An assistant asks the
person before anything is posted publicly, and leaves opening the issue and posting it to the
person ([agents.md](agents.md#reporting-a-gate-problem)).

## Other issues

The other forms are **Bug** (with `pxsig version` and `pxsig doctor --plain`), **Feature** and
**Documentation**. Blank issues are off.
