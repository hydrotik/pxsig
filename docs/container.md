# The container image

`ghcr.io/hydrotik/pxsig` is pxsig with its engine, Playwright's three browsers (Chromium, Firefox,
WebKit) and a fixed font set, on Ubuntu 24.04. Renders made in it are the same on every machine,
so baselines approved from them stay valid in CI and on every developer's machine. Nothing changes
for anyone who does not use it: Docker is never required.

## Tags

| Tag | Example | Moves? |
| --- | --- | --- |
| `<pxsig>-pw<playwright>` | `0.5.0-pw1.58.2` | never: a multi-arch manifest over the two below |
| `<pxsig>-pw<playwright>-amd64`, `-arm64` | `0.5.0-pw1.58.2-amd64` | never |
| `<pxsig>-pw<playwright>-r<N>` | `0.5.0-pw1.58.2-r2` | never: a rebuild of the same pair, for example a base-image security fix |

There is no `latest`. amd64 is the canonical architecture: approve baselines from amd64 renders.
Pick the tag whose Playwright is the one in your lockfile, and pin it by digest:

```
ghcr.io/hydrotik/pxsig:0.5.0-pw1.58.2@sha256:…
```

The image workflow's run summary prints each tag's digest. Every image is built by
`.github/workflows/image.yml` from the pxsig release on npm and carries a provenance attestation:

```bash
gh attestation verify oci://ghcr.io/hydrotik/pxsig:0.5.0-pw1.58.2 -R hydrotik/pxsig
```

Images are built for the latest pxsig, for every Playwright minor from 1.58 on; images for older
pairs stay published, unmaintained.

## What is in it

| Part | |
| --- | --- |
| Base | `mcr.microsoft.com/playwright:v<playwright>-noble`: the browsers and their system libraries |
| pxsig | `pxsig@<version>` from npm under `/opt/pxsig`, with its Linux engine (`PXSIG_BIN=/opt/pxsig/engine/pxsig`) |
| Playwright | the image's own `playwright@<version>` under `/opt/pxsig`; `PXSIG_PLAYWRIGHT` makes pxsig use it before the project's, so the driver always matches the browsers |
| Fonts | the base image's set; the label `io.pxsig.fonts` is the same digest a render reports as `fonts.system` |
| Environment | `PXSIG_NO_DELEGATE=1` (the image's pxsig runs, not the mounted project's), `PXSIG_IMAGE`, `PXSIG_IMAGE_REVISION`, `TZ=UTC`, `LANG=C.UTF-8` |
| Labels | `org.opencontainers.image.*`, `io.pxsig.version`, `io.pxsig.playwright`, `io.pxsig.fonts` |
| User | `pwuser`, from the base image |

## Mode (i): the whole check in the container

```bash
docker run --rm -v "$PWD":/work -w /work ghcr.io/hydrotik/pxsig:0.5.0-pw1.58.2@sha256:… \
  pxsig check --full --project design-system --storybook-static apps/storybook/storybook-static
```

Build Storybook first (`storybook build`); the check serves the static build itself. Renders,
`check.json` and diffs land in the mounted store. `pxsig serve` on the host then reviews them, and
an approval writes the render's environment into the baseline, not the host's.

On Linux, bind-mounted files are created as the container's user; pass your own so they stay
yours:

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/hydrotik/pxsig:… pxsig check --full
```

This is the mode for CI: the one-liner above, or the image as a job's `container:`. Set
`PXSIG_IMAGE_DIGEST` to the pinned digest so each render records it (an image cannot know its own
digest).

## Mode (ii): only the browser in the container

For the review loop on a Mac or Windows machine: Storybook, the engine and the dashboard run on the
host, and the screenshots come from the container's browser.

```bash
pxsig browser start                    # the image for this pxsig and the project's Playwright
pxsig check --full --browser ws://127.0.0.1:3000/
PXSIG_BROWSER_WS=ws://127.0.0.1:3000/ pxsig serve   # dashboard re-checks render there too
pxsig browser status
pxsig browser stop
```

- `pxsig browser start [--image tag] [--port 3000]` runs `playwright run-server` in the image,
  published on `127.0.0.1` only, and records the endpoint, image and digest in
  `node_modules/.cache/pxsig/browser.json`.
- `--browser <ws>`, `PXSIG_BROWSER_WS` or `capture.browserEndpoint` make every check and the server
  connect to that browser instead of launching one. The browser reaches the host's `localhost`
  (Storybook) through Playwright's `exposeNetwork`.
- The project's Playwright must have the image's major.minor: Playwright refuses any other pairing.
  `pxsig browser status` warns when they differ.
- The render environment then comes from the container's browser: its OS from the page, the image
  and digest from `browser.json`. `fonts.system` is `null` (the host cannot list the container's
  fonts; `fonts.probe` measures them).

| | (i) whole check in the container | (ii) browser in the container |
| --- | --- | --- |
| Same pixels as CI | yes | yes (the engine is the same on every OS) |
| Speed on Apple silicon | amd64 runs emulated; bind-mount IO | native Node and engine; screenshots cross a WebSocket |
| `pxsig serve` re-checks | on the host, unless serve uses (ii) too | in the container |
| Playwright versions | the image's, always matched | the project's must match the image's major.minor |
| Storybook | the static build in the mount | the host's dev server or static build |

## On each OS

| OS | |
| --- | --- |
| Linux | Docker Engine. Use `--user` for bind mounts (above). |
| macOS | Docker Desktop, Colima or OrbStack. On Apple silicon the amd64 image runs under emulation (slower); mode (ii) keeps the review loop fast. |
| Windows | Docker Desktop with the WSL 2 backend. On a managed machine without Docker, nothing changes: checks launch the local browser, and the render environment says so. |

`pxsig browser start`, `stop` and `status` are the only commands that start `docker`
([platforms.md](platforms.md#programs-pxsig-starts)). Without the docker CLI, or with its daemon
stopped, they exit 2 with a setup error, and nothing else in pxsig changes.

`pxsig doctor` warns (`image-mismatch`) when, inside the image, the Playwright that resolves or the
pxsig the project pins is not the one the image is built for.
