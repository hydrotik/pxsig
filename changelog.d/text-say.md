### Added

- **Text labels in `pxsig entry`, `pxsig list`, MCP and summary.md.** A check row's `textDiff` is
  now said in the same words everywhere: `pxsig entry` shows a Text block after the gate reasons
  (the kind, then one sentence per change, such as `Copy: "1" → "1␠" (whitespace only: a space
  added)` or `"new · of 1" moved 4.2px right, and 2 more runs the same way, pushed by the copy
  change "1" → "1␠"`, then the changed pixels outside text), and `--json` carries `textDiff` and
  `textLines`. MCP `pxsig_entry` carries `textDiff` in full and `textLines`; each listed entry
  carries `textKind` and `textSummary`, or `textState` when text was not compared. A row whose
  environment differs from its baseline's says that text is compared only within one environment,
  and that a render from this environment approved as the baseline gives it labels. Labels only:
  every state, verdict, exit code, SARIF result and JUnit outcome is the same with or without them.
- **`pxsig list --text <kind>` and `pxsig_list`'s `text`.** Keep the entries whose text labels are
  one kind (`copy`, `copy-reflow`, `moved`, `restyled`), or `any` text change. With no state named,
  every state is searched, since a copy change under the gate still passes.

### Behaviour changes

- **`pxsig list`'s Why column and summary.md name the text kind.** After an entry's first reason
  (`pxsig list`) or its reasons (summary.md's table of changed entries) comes `· text: copy,
  reflow` (or `copy`, `moved`, `restyled`) when its text was compared; nothing for a pixel change.
  To update: nothing to do; a script that parses the Why column or summary.md's table sees the
  suffix after the reasons, and every count, verdict and exit code is unchanged.
- **MCP `pxsig_list` and `pxsig_check` entries carry `textKind`, `textState` or `textSummary`**
  when the row has text labels; `pxsig_entry` also carries `textDiff` and `textLines`.
  To update: nothing to do; a client gets more keys, and no key it read before changes.
