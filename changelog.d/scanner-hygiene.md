### Behaviour changes

- **`engines.node` is `>=22`** for `pxsig` and `@pxsig/storybook-addon` (was `>=20` for `pxsig`).
  Node 20 reached end of life in April 2026 and was never tested; CI runs Node 22. npm prints an
  `EBADENGINE` warning on Node 20, and refuses the install only with `engine-strict`.

### Changed

- **The dashboard bundle ships unminified.** `dist/dashboard/assets/app.js` in the npm package now
  reads as code, so a reviewer can audit what runs. `PXSIG_DASHBOARD_MINIFY=1` at build time (also
  for `pxsig dashboard build`) minifies it.
- **The published `package.json` files carry no `scripts` or `devDependencies`.** `pxsig`'s
  `prepack` pointed at a file outside the package; the release now runs that step itself, strips
  both keys (`scripts/pack-manifest.mjs`) and fails if a packed manifest still has them.
- **The research harness's token overrides are no longer code.** A scenario's `tokens` value is a
  literal, `{ "scale": n }` or `{ "mix": colour, "amount": pct }`; the `"fn:<body>"` form is refused
  with a message (`tools/`, not part of the npm package).

### Security

- **pxsig evaluates no code at runtime.** axe-core is added to the rendered page with Playwright's
  `addScriptTag` instead of `new Function`, in `check` and `dashboard check`.
- **`SECURITY.md` lists what package scanners report** (programs started, network, URL strings,
  environment, filesystem, dynamic import, native binaries, the bundled page) with where each is in
  the code and what bounds it. The links in the coding-assistant marker table moved from the code
  to `docs/agents.md#sources`.
