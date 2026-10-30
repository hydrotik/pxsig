### Fixed

- **A JSON file saved with a byte order mark is read.** Windows Notepad (and PowerShell's
  `Out-File -Encoding utf8` in Windows PowerShell 5) start a UTF-8 file with a byte order mark, and
  pxsig failed on such a `pxsig.config.json` or `pxsig.workspace.json` with "is not valid JSON".
  pxsig now skips the mark in every JSON file it reads. A file saved as UTF-16 (Notepad's
  "Unicode", Windows PowerShell's `>` redirect) is refused with a message naming the file and its
  encoding (`<path> is UTF-16 LE; save it as UTF-8`). Nothing to do.
