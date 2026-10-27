---
description: Check the branch for names from other repositories (files, commit messages, a PR body) and reword any hits
argument-hint: '[base ref, default origin/main] [PR body file]'
---

Names from other repositories only reach this one when someone has read another repository (a peer
design system, a consuming app, a sibling checkout). Run this after any such work, and before
pushing a branch or opening a pull request that came out of it.

Arguments: `$ARGUMENTS`: the base ref (default `origin/main`), then optionally a PR body file.

1. Run the check with the denylist, over tracked files, the branch's commit messages and, when
   given, a draft PR body:

   ```bash
   node scripts/check-clean.mjs --require-terms --since <base> [--text <pr-body.md>]
   ```

   `--all` adds untracked files on disk (a new file not yet added).

2. If it fails with "no denylist", stop and tell the maintainer: the list lives only on their
   machine (`~/.config/pxsig/clean-terms` or `.clean-terms` in the main checkout). Do not create
   or guess one.

3. Every hit is printed as a location only (`file:line`, `commit <sha>:line`), never the name. For
   each one, read the line and reword it in neutral terms: "a design system", "the consuming
   app", `packages/ui`, `my-design-system`. Rename identifiers the same way. Never write the name
   anywhere else (a note, a reply, a commit message) while fixing it.

4. A hit in a commit message that is already pushed needs a rewritten history, which is the
   maintainer's call: report the commit and stop. An unpushed one can be reworded with
   `git commit --amend` (last commit) or a fresh commit series.

5. Re-run step 1 until it passes, then report what was reworded, by file and line.
