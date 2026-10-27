### Fixed

- **The container image's smoke test installs the examples with the repository's pnpm.** The staged
  example sits outside the checkout, so Corepack fetched the newest pnpm (12), which fails on
  ignored build scripts; the 0.5.0 image build stopped there, before pushing anything.
