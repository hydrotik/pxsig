### Behaviour changes

- **`pxsig dashboard check` takes a screen again when one of its page's requests ran out of socket
  buffers.** The dashboard asks for its data, whether it can approve and its live connection once,
  after the page loads; on Windows, with several screens loading at once, one of those requests
  could fail with `net::ERR_NO_BUFFER_SPACE`, and the page then never showed that state (the top
  bar's `Can approve`), so the screen failed with `landmark missing`. Such a screen is now taken
  again once, after 500 ms, as a failed page load already was, and gets `"retried":
  "ERR_NO_BUFFER_SPACE"` in `report.json` and a line under "Retried" in `summary.md`. A screen that
  still fails names the requests that failed in its reason, e.g. `landmark missing: text "Can
  approve" (request failed: /__pxsig/status net::ERR_CONNECTION_REFUSED)`; any other error is not
  retried.
  To update: nothing to do; `retried` keeps its one value, and a reason may now end with the
  failed requests.
