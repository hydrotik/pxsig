### Fixed

- **One transient socket failure no longer fails a whole operation.** On a loaded machine (seen on
  Windows) a single connection to a local server can be reset, refused or run out of socket
  buffers while the server is up. Now the pxsig server status check (`approve --apply`, `doctor`,
  repair's re-check) retries once after 250 ms on a timeout, a reset or a refused connection before
  it says the server is not running; the Storybook reachability check retries once on a reset
  connection; and a story render whose navigation broke (for example `net::ERR_NO_BUFFER_SPACE` or
  `net::ERR_CONNECTION_RESET`) retries once on a fresh page, and a navigation that still fails
  fails only its own entry instead of every entry after it on that page. An answer from the server
  (an HTTP error, Storybook's error screen) is never retried. "The pxsig server is not running"
  now takes about 250 ms longer to answer.
  To update: nothing to do; no option, output or exit code changes.
