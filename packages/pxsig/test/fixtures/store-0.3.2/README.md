# A store as pxsig 0.3.2 wrote it

Text records only (check-clean keeps images and baselines out of the repository; the tests build
the baselines with `fixture.mjs`). `upgrade.test.mjs` lays these over a fixture project and runs
the commands that read a store.

- `approvals.ndjson`: 0.3.2 log lines, with `by` (placeholder addresses) and no `pxsig` version.
- `lock.json`: a 0.3.2 lock (no `nonce`, `generation` or `heartbeatAt`); `HOST` and `PID` are filled
  in by the test (a pid that is gone).
- `serve-6070.token`: a token file where 0.3.2 put it on every OS (`node_modules/.cache/pxsig/`).
