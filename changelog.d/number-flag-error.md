### Breaking changes

- **A number flag with a bad value is an error: `pxsig` exits 2 and runs nothing.** A value that
  was not a number was read as the default, so `pxsig serve --port notaport` served on 6070 and
  `pxsig list --limit 0` showed 30 rows, without a word. Now every `<n>` flag takes a whole number
  (`--retries`, `--settle-ms` and `--min-cell-px` from 0, the others from 1; a port up to 65535)
  and a bad one is named: `pxsig: --port takes a whole number from 1 to 65535 (got "notaport")`.
  To update: a script that passes such a value now fails; pass a number in the range, or leave the
  flag out.
