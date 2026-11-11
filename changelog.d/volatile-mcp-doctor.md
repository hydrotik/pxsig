### Added

- **Masks in the MCP tools.** `pxsig_list` (and every answer that lists entries in brief) carries
  `masksChanged` (added, removed, grew: selectors) when the masks differ from the baseline's, and
  `masksLarge` for a mask over 25% of the capture. `pxsig_entry` adds the render's masks in full
  (`masks`: selector, source, reason, share of the capture), the baseline's beside a change
  (`masksBaseline`) and one sentence per large mask (`maskWarnings`) (docs/mcp.md, Masks).
- **`pxsig doctor` lists the masks in force.** A Masks row says that every `[data-volatile]`
  element is masked wherever it renders, how many selectors the config adds and how many baselines
  record masks; a Masks table lists each `capture.ignore` / `capture.addIgnore` selector with the
  layer that set it (workspace defaults or project config), as `pxsig config` does. `--json` and
  `pxsig_doctor` carry it as `masks`. Information only: the exit is unchanged.
