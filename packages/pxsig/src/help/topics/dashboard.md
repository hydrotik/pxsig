# The dashboard on another design system

The dashboard renders through a UI contract of neutral components. The reference adapter uses
one design system; a team can build the same dashboard on its own, chosen once at build time.

1. Write an adapter: one module that implements the contract on the design system. The
   step-by-step guide, written for a person or a coding agent, is
   `node_modules/pxsig/docs/ui/build-adapter.md`; `examples/custom-ui/` is a plain example.
2. Point the project at it: `"dashboard": { "ui": "./pxsig-ui" }` in `pxsig.config.json`
   (or `--ui`, or `PXSIG_UI_ADAPTER`).
3. `pxsig dashboard gaps` lists what the adapter covers, and what falls back to a plain
   rendering. Exit 1 when a required component is missing.
4. `pxsig dashboard build` builds it with the project's own Vite. `pxsig serve` then serves that
   build while it is current, else the prebuilt dashboard, with a line saying how to rebuild.

See `pxsig help dashboard`, docs/ui/build-adapter.md, docs/ui/features.md.
