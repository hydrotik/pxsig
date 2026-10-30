# syntax=docker/dockerfile:1
#
# ghcr.io/hydrotik/pxsig:<pxsig>-pw<playwright>: pxsig, its engine, Playwright's three browsers and a
# fixed font set on Ubuntu 24.04, so every machine renders the same pixels (docs/container.md).
# Built and published by .github/workflows/image.yml from the pxsig release on npm; nothing here
# is copied from the checkout.
#
#   docker build -f docker/Dockerfile --build-arg PXSIG_VERSION=0.5.0 --build-arg PLAYWRIGHT_VERSION=1.58.2 .
#
# The image's own Playwright (PXSIG_PLAYWRIGHT) drives the browsers installed beside it, whatever
# the mounted project pins; PXSIG_NO_DELEGATE makes the image's pxsig run, not the project's.

ARG PLAYWRIGHT_VERSION
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG PXSIG_VERSION
ARG PLAYWRIGHT_VERSION
ARG IMAGE_TAG=""
ARG REVISION=""
# sha256 of the sorted `fc-list : family style` output (the workflow's first build measures it):
# the same digest a render's environment reports as fonts.system.
ARG FONTS_SHA=""
ARG TARGETARCH

RUN test -n "$PXSIG_VERSION" && test -n "$PLAYWRIGHT_VERSION"

WORKDIR /opt/pxsig
# npm installs the engine package for this architecture (pxsig's optional dependency). The engine
# is linked as /opt/pxsig/engine/pxsig: pxsig starts it by that name (lib/spawn.mjs). No package
# installed here has an install script (pxsig, its engine, axe-core, pngjs, playwright), so none run.
RUN printf '{ "name": "pxsig-image", "private": true }\n' > package.json \
 && npm install --no-audit --no-fund --omit=dev --ignore-scripts "pxsig@${PXSIG_VERSION}" "playwright@${PLAYWRIGHT_VERSION}" \
 && npm cache clean --force \
 && arch="$( [ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64 )" \
 && test -x "node_modules/@pxsig/cli-linux-${arch}/bin/pxsig" \
 && mkdir -p engine && ln -s "/opt/pxsig/node_modules/@pxsig/cli-linux-${arch}/bin/pxsig" engine/pxsig \
 && engine/pxsig --version \
 && test "$(node -p "require('playwright/package.json').version")" = "$PLAYWRIGHT_VERSION"

ENV PATH="/opt/pxsig/node_modules/.bin:${PATH}" \
    PXSIG_BIN=/opt/pxsig/engine/pxsig \
    PXSIG_NO_DELEGATE=1 \
    PXSIG_PLAYWRIGHT=/opt/pxsig/node_modules/playwright \
    PXSIG_IMAGE="${IMAGE_TAG}" \
    PXSIG_IMAGE_REVISION="${REVISION}" \
    TZ=UTC \
    LANG=C.UTF-8

LABEL org.opencontainers.image.title="pxsig" \
      org.opencontainers.image.description="pxsig visual regression with Playwright's browsers and a fixed font set" \
      org.opencontainers.image.source="https://github.com/hydrotik/pxsig" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${IMAGE_TAG}" \
      org.opencontainers.image.revision="${REVISION}" \
      io.pxsig.version="${PXSIG_VERSION}" \
      io.pxsig.playwright="${PLAYWRIGHT_VERSION}" \
      io.pxsig.fonts="${FONTS_SHA}"

USER pwuser
WORKDIR /work
CMD ["pxsig", "--help"]
