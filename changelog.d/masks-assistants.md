### Changed

- **Assistants are told never to pass an entry by masking it.** The instruction `pxsig setup`
  prints, the MCP server's instructions, the descriptions of `pxsig_check`, `pxsig_list`,
  `pxsig_entry` and `pxsig_rejected`, and a rejection's prompt all say, word for word: "Never add a
  mask, ignore, `data-volatile` or raise a threshold to make an entry pass; flag the entry for a
  person instead." docs/agents.md has a Masks section.
  `pxsig setup` never edits an instruction file that exists: add the two lines by hand
  (`pxsig setup --print` prints the whole instruction).
