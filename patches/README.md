# Patched dependencies

pnpm applies these through `pnpm.patchedDependencies` in package.json. Each patch is recorded in
pnpm-lock.yaml, so `pnpm install --frozen-lockfile` applies it.

## picomatch@4.0.7.patch

- **Why:** [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
  (CVE-2026-112366), a ReDoS through single-branch repeated extglobs such as `+(*a)` and `+(*)`.
  Every picomatch release up to and including 4.0.7 is affected, and no fixed release exists yet.
- **Where picomatch comes from:** development tooling only (vite, tinyglobby, fdir, lint-staged,
  and the examples' Storybook and vite). Nothing pxsig publishes contains it.
- **What it changes, in `lib/parse.js`:**
  - A single branch of plain tokens around a `*` (`+(*a)`, `*(a*)`, `+(*)`) is emitted without the
    outer repeat. Repeating that branch matches the same strings, so its meaning is unchanged.
    This follows micromatch/picomatch#254.
  - In a body with several branches, a branch that starts with a bare `*` or `?` followed by more
    content (`+(*a|b)`) is emitted as a literal, as for other risky extglobs. This follows micromatch/picomatch#238.
  - A single branch with a bare `*` and a nested extglob (`+(@(a)*)`) is emitted as a literal,
    unless a `/` outside the nested extglob fixes where each repetition ends.
  - Globs without a repeated extglob (`+(` or `*(`) are unaffected.
- **Not covered:** two forms still backtrack on long failing inputs, with or without the patch:
  - a single branch made of nested quantified extglobs, e.g. `+(*(a)?(a))`;
  - several branches where one ends in a bare `*`, e.g. `+(a*|b)`.

  Both are outside the advisory and no upstream change fixes them yet. Rewriting them would change
  matches that picomatch's own tests pin (`*(f*(o))`, `*(a*|b)`), so they are left for upstream. No
  glob in this repository or in the tools that load picomatch here uses either form.

- **Copies:** each example under `examples/` installs from its own lockfile and is tested from a
  copy outside this repository. Each therefore keeps an identical copy at
  `examples/<name>/patches/picomatch@4.0.7.patch`, and `scripts/picomatch-redos.test.mjs` checks
  that the copies match.
- **Remove it** when picomatch releases a fix: upgrade the dependents, delete the patch, its copies,
  every `patchedDependencies` entry and `scripts/picomatch-redos.test.mjs`, then refresh the lockfiles.
