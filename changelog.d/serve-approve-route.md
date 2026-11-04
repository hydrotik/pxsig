### Changed

- **A dashboard approval does less work before it answers.** The server's approve reads
  `check.json` once instead of three times, and reads the commit for the approvals log
  (`gitHead`) while the engine writes the baseline, instead of blocking the server on `git`
  afterwards. The log line and the files written are the same.
