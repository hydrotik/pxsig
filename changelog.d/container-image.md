### Added

- **The container image `ghcr.io/hydrotik/pxsig:<pxsig>-pw<playwright>`** (amd64 and arm64, amd64
  canonical): pxsig and its engine, Playwright's three browsers and a fixed font set on Ubuntu
  24.04, so renders are the same on every machine. Tags never move (`-rN` for a rebuild) and there
  is no `latest`; each image has a provenance attestation. Built by `.github/workflows/image.yml`
  after each release, by hand for a new Playwright, with a weekly check for one
  ([docs/container.md](docs/container.md)).
- **Two ways to use it.** The whole check in the container (`docker run … pxsig check --full`), or
  only the browser: `pxsig browser start|stop|status` runs Playwright's browser server in the image
  on `127.0.0.1`, and `--browser <ws>` (also `PXSIG_BROWSER_WS`, `capture.browserEndpoint`) makes a
  check or `pxsig serve` render there while Storybook and the engine stay on the host. The render
  environment then reports the container's browser and image.
- **`PXSIG_PLAYWRIGHT`**: a Playwright package folder pxsig loads before the project's (the image
  sets its own). `pxsig doctor` warns (`image-mismatch`) when, inside the image, the Playwright or
  the pinned pxsig differs from the image's.
- `docker` joins "Programs pxsig starts" (docs/platforms.md): only `pxsig browser` starts it.

No behaviour change: without the image, `--browser`, `PXSIG_BROWSER_WS`, `capture.browserEndpoint`
or `PXSIG_PLAYWRIGHT`, browsers launch and Playwright resolves exactly as before.
