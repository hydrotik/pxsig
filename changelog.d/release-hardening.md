### Added

- **Releases carry checksums, provenance and SBOMs.** From 0.4.0 each GitHub release has
  `SHA256SUMS`, a provenance attestation for every file (the npm tarballs, the raw binaries and the
  dashboard), and CycloneDX SBOMs for the npm package and the Rust engine. npm publishes the exact
  tarballs that were checksummed. Verifying: `docs/releasing.md#verifying-a-release`. No change to
  what pxsig does.
