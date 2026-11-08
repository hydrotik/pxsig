### Added

- **`.psig` files can carry more sections, and pxsig keeps them.** The engine reads and writes
  sections beyond `sig` and `image`, after them in the table, each with an `encoding` (`deflate`,
  raw DEFLATE, or `identity`); `length` and `sha256` stay those of the stored bytes. `pxsig attach`
  keeps every such section byte for byte, as it keeps unknown header keys, so decoding a baseline
  and writing back what was read gives the same bytes. `pxsig cat` (git's textconv) prints a
  `boxes` section's run strings after the header, one a line and JSON-quoted, so a copy change
  shows in a baseline's `git diff`. Nothing writes a `boxes` section yet: text capture comes in a
  later change, and every existing baseline reads, attaches and prints exactly as before. The
  container version stays 1, and older pxsig skips the new sections (docs/spec.md section 5).
