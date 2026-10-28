### Changed

- **The prebuilt dashboard is built with Vite 8.** The bundle in the `pxsig` package
  (`dist/dashboard`) now comes from Vite 8 (Rolldown) instead of Vite 6. It has the same features
  and renders the same screens; it still runs as a classic script, so a static report opens from
  disk.
- **`pxsig dashboard build` works on Vite 6, 7 and 8.** It uses the project's own Vite as before.
  On Vite 8 the build no longer warns about `inlineDynamicImports`, and `PXSIG_DASHBOARD_MINIFY=1`
  uses that Vite's own minifier (Oxc on 8, esbuild before).

### Documentation

- `docs/ui/build-adapter.md` names the Vite versions `pxsig dashboard build` supports, and the
  Node.js version Vite 8 needs.
